import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import type { App } from 'supertest/types';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'crypto';
import { getRedisConnectionToken } from '@nestjs-modules/ioredis';
import type Redis from 'ioredis';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { REFRESH_COOKIE_NAME } from '../src/auth/refresh-token.constants';

// Sprint 01A e2e coverage. Requires `docker-compose up -d` (Postgres +
// Redis) from engmasterai-backend/ — this suite talks to both for real,
// matching the project's existing curl/build-verification convention
// rather than introducing a mocking layer for full-stack auth flows.

type SetCookieHeader = string[] | undefined;

interface AuthApiResponseBody {
  accessToken: string;
}

const accessTokenOf = (res: request.Response): string =>
  (res.body as AuthApiResponseBody).accessToken;

const extractCookieValue = (
  setCookie: SetCookieHeader,
  name: string,
): string | undefined => {
  const line = setCookie?.find((c) => c.startsWith(`${name}=`));
  if (!line) return undefined;
  const withoutName = line.slice(name.length + 1);
  return withoutName.split(';')[0];
};

const cookieLineFor = (
  setCookie: SetCookieHeader,
  name: string,
): string | undefined => setCookie?.find((c) => c.startsWith(`${name}=`));

describe('Auth (e2e) — Sprint 01A: Redis sessions, strict single-use refresh rotation, tolerant logout', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: Redis;
  const createdUserEmails: string[] = [];

  const uniqueEmail = (): string => {
    const email = `sprint01a-${randomUUID()}@example.test`;
    createdUserEmails.push(email);
    return email;
  };

  const registerUser = async () => {
    const email = uniqueEmail();
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: 'Sprint 01A Test User', email, password: 'password123' });
    return { email, res };
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe());
    await app.init();

    prisma = app.get(PrismaService);
    redis = app.get(getRedisConnectionToken());
  }, 30000);

  afterAll(async () => {
    if (createdUserEmails.length > 0) {
      await prisma.user.deleteMany({
        where: { email: { in: createdUserEmails } },
      });
    }
    await app.close();
  });

  describe('login', () => {
    it('returns an accessToken in the body (never the refresh secret) and sets the refresh cookie', async () => {
      const { res } = await registerUser();

      expect(res.status).toBe(201);
      expect(accessTokenOf(res)).toEqual(expect.any(String));
      expect(res.body).not.toHaveProperty('refreshCookieValue');

      const setCookie = res.headers['set-cookie'] as unknown as SetCookieHeader;
      const cookieLine = cookieLineFor(setCookie, REFRESH_COOKIE_NAME);
      expect(cookieLine).toBeDefined();
      expect(cookieLine).toMatch(/HttpOnly/i);
      expect(cookieLine).toMatch(/SameSite=Lax/i);
      expect(cookieLine).toMatch(/Path=\/auth/i);
    });
  });

  describe('refresh — strict single-use rotation (no grace window)', () => {
    it('one refresh succeeds and rotates the token', async () => {
      const { res: registerRes } = await registerUser();
      const cookie = extractCookieValue(
        registerRes.headers['set-cookie'] as unknown as SetCookieHeader,
        REFRESH_COOKIE_NAME,
      );

      const refreshRes = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', `${REFRESH_COOKIE_NAME}=${cookie}`);

      expect(refreshRes.status).toBe(201);
      expect(accessTokenOf(refreshRes)).toEqual(expect.any(String));
      // Not asserting the access-token *string* differs from registration's:
      // JWTs are deterministic (same payload + same `iat` second + same
      // secret = an identical signature), so a register+refresh pair that
      // lands within the same wall-clock second legitimately produces byte-
      // identical tokens — that's a property of JWTs, not a rotation
      // failure. The refresh cookie's rotated secret (asserted below) is
      // the real, reliable proof that rotation happened.

      const newCookie = extractCookieValue(
        refreshRes.headers['set-cookie'] as unknown as SetCookieHeader,
        REFRESH_COOKIE_NAME,
      );
      expect(newCookie).toBeDefined();
      expect(newCookie).not.toBe(cookie);
    });

    it('the old (just-rotated-away) token immediately fails, and the latest token also fails afterward (whole family revoked)', async () => {
      const { res: registerRes } = await registerUser();
      const originalCookie = extractCookieValue(
        registerRes.headers['set-cookie'] as unknown as SetCookieHeader,
        REFRESH_COOKIE_NAME,
      );

      const firstRefresh = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', `${REFRESH_COOKIE_NAME}=${originalCookie}`);
      expect(firstRefresh.status).toBe(201);
      const latestCookie = extractCookieValue(
        firstRefresh.headers['set-cookie'] as unknown as SetCookieHeader,
        REFRESH_COOKIE_NAME,
      );

      const reuseAttempt = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', `${REFRESH_COOKIE_NAME}=${originalCookie}`);
      expect(reuseAttempt.status).toBe(401);

      const followUp = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', `${REFRESH_COOKIE_NAME}=${latestCookie}`);
      expect(followUp.status).toBe(401);
    });

    it('two concurrent refresh requests against the same starting cookie produce exactly one success; the loser triggers family revocation', async () => {
      const { res: registerRes } = await registerUser();
      const cookie = extractCookieValue(
        registerRes.headers['set-cookie'] as unknown as SetCookieHeader,
        REFRESH_COOKIE_NAME,
      );

      const [a, b] = await Promise.all([
        request(app.getHttpServer())
          .post('/auth/refresh')
          .set('Cookie', `${REFRESH_COOKIE_NAME}=${cookie}`),
        request(app.getHttpServer())
          .post('/auth/refresh')
          .set('Cookie', `${REFRESH_COOKIE_NAME}=${cookie}`),
      ]);

      expect([a.status, b.status].sort()).toEqual([201, 401]);

      const winner = a.status === 201 ? a : b;
      const winnerCookie = extractCookieValue(
        winner.headers['set-cookie'] as unknown as SetCookieHeader,
        REFRESH_COOKIE_NAME,
      );

      const followUp = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', `${REFRESH_COOKIE_NAME}=${winnerCookie}`);
      expect(followUp.status).toBe(401);
    });

    it('malformed or absent refresh cookie returns a clean 401, not a 500', async () => {
      const noCookie = await request(app.getHttpServer()).post('/auth/refresh');
      expect(noCookie.status).toBe(401);

      const malformed = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', `${REFRESH_COOKIE_NAME}=not-a-valid-shape-no-separator`);
      expect(malformed.status).toBe(401);
    });
  });

  describe('logout — idempotent, best-effort (Sprint 01A §6.A.5)', () => {
    it('immediately rejects the just-used access token on a protected route (blacklist effective before natural expiry)', async () => {
      const { res: registerRes } = await registerUser();
      const accessToken = accessTokenOf(registerRes);
      const cookie = extractCookieValue(
        registerRes.headers['set-cookie'] as unknown as SetCookieHeader,
        REFRESH_COOKIE_NAME,
      );

      const beforeLogout = await request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(beforeLogout.status).toBe(200);

      const logoutRes = await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Cookie', `${REFRESH_COOKIE_NAME}=${cookie}`);
      expect(logoutRes.status).toBe(201);
      expect(logoutRes.body).toEqual({ message: 'Logout successful' });

      const afterLogout = await request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(afterLogout.status).toBe(401);
    });

    it('works when the access token is expired', async () => {
      const { res: registerRes } = await registerUser();
      const cookie = extractCookieValue(
        registerRes.headers['set-cookie'] as unknown as SetCookieHeader,
        REFRESH_COOKIE_NAME,
      );

      const jwt = app.get(JwtService);
      const expiredToken = await jwt.signAsync(
        { sub: randomUUID(), email: 'irrelevant@example.test', role: 'USER' },
        { secret: process.env.JWT_SECRET, expiresIn: '-10s' },
      );

      const logoutRes = await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Authorization', `Bearer ${expiredToken}`)
        .set('Cookie', `${REFRESH_COOKIE_NAME}=${cookie}`);

      expect(logoutRes.status).toBe(201);
      expect(logoutRes.body).toEqual({ message: 'Logout successful' });
    });

    it('works when the access token is missing entirely', async () => {
      const { res: registerRes } = await registerUser();
      const cookie = extractCookieValue(
        registerRes.headers['set-cookie'] as unknown as SetCookieHeader,
        REFRESH_COOKIE_NAME,
      );

      const logoutRes = await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Cookie', `${REFRESH_COOKIE_NAME}=${cookie}`);

      expect(logoutRes.status).toBe(201);
      expect(logoutRes.body).toEqual({ message: 'Logout successful' });
    });

    it('still revokes the refresh family via the cookie — a subsequent refresh fails', async () => {
      const { res: registerRes } = await registerUser();
      const cookie = extractCookieValue(
        registerRes.headers['set-cookie'] as unknown as SetCookieHeader,
        REFRESH_COOKIE_NAME,
      );

      await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Cookie', `${REFRESH_COOKIE_NAME}=${cookie}`);

      const refreshAfterLogout = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', `${REFRESH_COOKIE_NAME}=${cookie}`);
      expect(refreshAfterLogout.status).toBe(401);
    });

    it('clears the refresh cookie on the response', async () => {
      const { res: registerRes } = await registerUser();
      const cookie = extractCookieValue(
        registerRes.headers['set-cookie'] as unknown as SetCookieHeader,
        REFRESH_COOKIE_NAME,
      );

      const logoutRes = await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Cookie', `${REFRESH_COOKIE_NAME}=${cookie}`);

      const clearedLine = cookieLineFor(
        logoutRes.headers['set-cookie'] as unknown as SetCookieHeader,
        REFRESH_COOKIE_NAME,
      );
      expect(clearedLine).toBeDefined();
      expect(clearedLine).toMatch(new RegExp(`^${REFRESH_COOKIE_NAME}=;`));
    });

    it('remains successful and idempotent on repeated calls with the same stale credentials', async () => {
      const { res: registerRes } = await registerUser();
      const accessToken = accessTokenOf(registerRes);
      const cookie = extractCookieValue(
        registerRes.headers['set-cookie'] as unknown as SetCookieHeader,
        REFRESH_COOKIE_NAME,
      );

      const first = await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Cookie', `${REFRESH_COOKIE_NAME}=${cookie}`);
      const second = await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Cookie', `${REFRESH_COOKIE_NAME}=${cookie}`);

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(first.body).toEqual({ message: 'Logout successful' });
      expect(second.body).toEqual({ message: 'Logout successful' });
    });
  });

  describe('no raw secrets in Redis', () => {
    it('the access-token blacklist and refresh-family records only ever contain hashes', async () => {
      const { res: registerRes } = await registerUser();
      const accessToken = accessTokenOf(registerRes);
      const cookie = extractCookieValue(
        registerRes.headers['set-cookie'] as unknown as SetCookieHeader,
        REFRESH_COOKIE_NAME,
      );

      await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Cookie', `${REFRESH_COOKIE_NAME}=${cookie}`);

      const blacklistKeys = await redis.keys('auth:atbl:*');
      for (const key of blacklistKeys) {
        const value = await redis.get(key);
        expect(key).not.toContain(accessToken);
        expect(value).not.toBe(accessToken);
      }

      const { res: secondRegister } = await registerUser();
      const secondCookie = extractCookieValue(
        secondRegister.headers['set-cookie'] as unknown as SetCookieHeader,
        REFRESH_COOKIE_NAME,
      );
      const separatorIndex = secondCookie!.indexOf('.');
      const familyId = secondCookie!.slice(0, separatorIndex);
      const secret = secondCookie!.slice(separatorIndex + 1);

      const raw = await redis.get(`auth:refresh:family:${familyId}`);
      expect(raw).not.toBeNull();
      expect(raw).not.toContain(secret);
    });
  });

  describe('guard consolidation — blacklist enforced across every module', () => {
    it('a blacklisted access token is rejected on a route from every module, not just /auth/*', async () => {
      const { res: registerRes } = await registerUser();
      const accessToken = accessTokenOf(registerRes);

      await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`);

      const randomId = randomUUID();
      const targets: string[] = [
        '/courses/manage',
        `/courses/${randomId}/lessons`,
        '/users/me',
        '/vocab/libraries/manage',
        `/vocab/words/${randomId}`,
        `/vocab/decks/${randomId}`,
      ];

      for (const path of targets) {
        const res = await request(app.getHttpServer())
          .get(path)
          .set('Authorization', `Bearer ${accessToken}`);
        expect(res.status).toBe(401);
      }
    });

    it('role-gated route still 403s a wrong-role authenticated user, and still 401s a missing token', async () => {
      const { res: registerRes } = await registerUser(); // USER role by default

      const wrongRole = await request(app.getHttpServer())
        .get('/courses/manage')
        .set('Authorization', `Bearer ${accessTokenOf(registerRes)}`);
      expect(wrongRole.status).toBe(403);

      const missingToken = await request(app.getHttpServer()).get(
        '/courses/manage',
      );
      expect(missingToken.status).toBe(401);
    });
  });

  describe('Redis outage — must not fail open, and must return 503 (not 401)', () => {
    let brokenApp: INestApplication<App>;

    beforeAll(async () => {
      const originalHost = process.env.REDIS_HOST;
      const originalPort = process.env.REDIS_PORT;
      process.env.REDIS_HOST = '127.0.0.1';
      process.env.REDIS_PORT = '1'; // unreachable — nothing listens on port 1

      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      brokenApp = moduleFixture.createNestApplication();
      brokenApp.use(cookieParser());
      brokenApp.useGlobalPipes(new ValidationPipe());
      await brokenApp.init();

      process.env.REDIS_HOST = originalHost;
      process.env.REDIS_PORT = originalPort;
    }, 30000);

    afterAll(async () => {
      await brokenApp.close();
    });

    it('a protected route returns 503, never a silent pass and never a 401', async () => {
      const res = await request(brokenApp.getHttpServer())
        .get('/users/me')
        .set('Authorization', 'Bearer irrelevant-token-value');
      expect(res.status).toBe(503);
    }, 20000);

    it('/auth/refresh returns 503', async () => {
      const res = await request(brokenApp.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', `${REFRESH_COOKIE_NAME}=some-family.some-secret`);
      expect(res.status).toBe(503);
    }, 20000);

    it('/auth/register fails fast with 503 (session issuance requires Redis) rather than a degraded silent success', async () => {
      const email = uniqueEmail();
      const res = await request(brokenApp.getHttpServer())
        .post('/auth/register')
        .send({
          name: 'Broken Redis Test User',
          email,
          password: 'password123',
        });
      expect(res.status).toBe(503);
    }, 20000);

    it('/auth/logout returns 503 — the one case where logout does not "always succeed"', async () => {
      // Must be a genuinely, validly-signed token: logout's tolerant
      // verification (ignoreExpiration: true) still checks the signature
      // *before* attempting the Redis-dependent blacklist write, so a
      // garbage/malformed bearer value would fail verification and skip
      // Redis entirely (a benign no-op, not the outage case this test is
      // for) — see auth.service.ts's logout() catch block.
      const jwt = brokenApp.get(JwtService);
      const validlySignedToken = await jwt.signAsync(
        { sub: randomUUID(), email: 'irrelevant@example.test', role: 'USER' },
        { secret: process.env.JWT_SECRET, expiresIn: '10m' },
      );

      const res = await request(brokenApp.getHttpServer())
        .post('/auth/logout')
        .set('Authorization', `Bearer ${validlySignedToken}`);
      expect(res.status).toBe(503);
    }, 20000);
  });
});
