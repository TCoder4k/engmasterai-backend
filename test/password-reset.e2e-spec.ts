import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'crypto';
import * as argon from 'argon2';
import { getRedisConnectionToken } from '@nestjs-modules/ioredis';
import type Redis from 'ioredis';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { REFRESH_COOKIE_NAME } from '../src/auth/refresh-token.constants';
import { MAIL_PROVIDER, MailProvider, RenderedEmail } from '../src/mail/mail.types';

// Sprint 02C e2e coverage. Requires `docker-compose up -d` (Postgres +
// Redis) from engmasterai-backend/, same convention as auth.e2e-spec.ts.
// The real ResendMailProvider is swapped for a capturing fake at the
// MAIL_PROVIDER injection boundary (ADR 005's own substitutable-provider
// design) — Postgres and Redis remain real throughout; only the outbound
// network call to the mail provider is stubbed, so the raw reset token
// (never persisted anywhere, by design) can be recovered from the rendered
// email exactly as a real inbox would present it.

type SetCookieHeader = string[] | undefined;

const extractCookieValue = (
  setCookie: SetCookieHeader,
  name: string,
): string | undefined => {
  const line = setCookie?.find((c) => c.startsWith(`${name}=`));
  if (!line) return undefined;
  const withoutName = line.slice(name.length + 1);
  return withoutName.split(';')[0];
};

interface CapturedEmail {
  to: string;
  rendered: RenderedEmail;
}

describe('Password Reset (e2e) — Sprint 02C: forgot/reset, cross-token invalidation, session revocation', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: Redis;
  const createdUserEmails: string[] = [];
  let capturedEmails: CapturedEmail[];

  const uniqueEmail = (): string => {
    const email = `sprint02c-${randomUUID()}@example.test`;
    createdUserEmails.push(email);
    return email;
  };

  const fakeMailProvider: MailProvider = {
    send: (rendered, to) => {
      capturedEmails.push({ to, rendered });
      return Promise.resolve({ success: true, durationMs: 0 });
    },
  };

  const extractResetToken = (rendered: RenderedEmail): string => {
    const match = /token=([^"&\s]+)/.exec(rendered.html);
    if (!match) throw new Error('No token found in rendered reset email');
    return decodeURIComponent(match[1]);
  };

  // registerUser() itself sends a verification email (Sprint 02B) to the
  // same address before forgot-password is ever called — a plain
  // `capturedEmails.find(e => e.to === email)` would silently grab that
  // earlier verification email instead (it also contains a `token=` URL),
  // extracting the wrong token entirely. Distinguish by URL shape.
  const findResetEmail = (email: string): CapturedEmail | undefined =>
    capturedEmails.find(
      (e) => e.to === email && e.rendered.html.includes('/reset-password?token='),
    );

  const registerUser = async () => {
    const email = uniqueEmail();
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: 'Sprint 02C Test User', email, password: 'password123' });
    return { email, res };
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MAIL_PROVIDER)
      .useValue(fakeMailProvider)
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe());
    await app.init();

    prisma = app.get(PrismaService);
    redis = app.get<Redis>(getRedisConnectionToken());
  }, 30000);

  // The forgot/reset rate-limit buckets are keyed on this test process's
  // real client IP against the app's real (dev) Redis instance — unlike
  // refresh-token.service.spec.ts, this suite exercises the actual
  // configured environment, not an isolated DB. Flushed before every test
  // (not just once in beforeAll): several tests in this file each make
  // their own forgot-password call, and the forgot-ip bucket's default max
  // (10 per hour) is smaller than the number of such calls this whole file
  // makes — without per-test isolation, later tests would spuriously 429
  // for reasons having nothing to do with what they're actually checking.
  // Only this feature's own bucket keys are touched, never any other
  // module's Redis state; the dedicated "rate limiting" test below still
  // correctly exhausts its own bucket from a clean slate.
  beforeEach(async () => {
    capturedEmails = [];
    const staleKeys = await redis.keys('auth:rl:password:*');
    if (staleKeys.length > 0) await redis.del(...staleKeys);
  });

  afterAll(async () => {
    if (createdUserEmails.length > 0) {
      await prisma.user.deleteMany({
        where: { email: { in: createdUserEmails } },
      });
    }
    await app.close();
  });

  describe('happy path', () => {
    it('resets the password end-to-end: old password stops working, new password works', async () => {
      const { email } = await registerUser();

      const forgotRes = await request(app.getHttpServer())
        .post('/auth/password/forgot')
        .send({ email });
      expect(forgotRes.status).toBe(201);
      expect(forgotRes.body).toEqual({
        message: 'If an account exists for this email, a password reset link has been sent.',
      });

      const resetEmail = findResetEmail(email);
      expect(resetEmail).toBeDefined();
      const rawToken = extractResetToken(resetEmail!.rendered);

      const resetRes = await request(app.getHttpServer())
        .post('/auth/password/reset')
        .send({ token: rawToken, newPassword: 'brand-new-password-456' });
      expect(resetRes.status).toBe(201);
      expect(resetRes.body).toEqual({
        message:
          'Password has been reset successfully. Please log in with your new password.',
      });
      // No session issued by this endpoint.
      expect(resetRes.body).not.toHaveProperty('accessToken');

      const oldPasswordLogin = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'password123', role: 'USER' });
      expect(oldPasswordLogin.status).toBe(403);

      const newPasswordLogin = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'brand-new-password-456', role: 'USER' });
      expect(newPasswordLogin.status).toBe(201);
    });

    it('sends a best-effort password-reset-success notice after a successful reset', async () => {
      const { email } = await registerUser();
      await request(app.getHttpServer())
        .post('/auth/password/forgot')
        .send({ email });
      const rawToken = extractResetToken(
        findResetEmail(email)!.rendered,
      );

      capturedEmails = [];
      await request(app.getHttpServer())
        .post('/auth/password/reset')
        .send({ token: rawToken, newPassword: 'another-new-password-789' });

      const notice = capturedEmails.find((e) => e.to === email);
      expect(notice).toBeDefined();
      expect(notice!.rendered.subject).toMatch(/mật khẩu/i);
    });
  });

  describe('generic response (no enumeration)', () => {
    it('returns the byte-identical response for a nonexistent email as for a real one', async () => {
      const { email } = await registerUser();

      const realRes = await request(app.getHttpServer())
        .post('/auth/password/forgot')
        .send({ email });
      const fakeRes = await request(app.getHttpServer())
        .post('/auth/password/forgot')
        .send({ email: `nonexistent-${randomUUID()}@example.test` });

      expect(realRes.status).toBe(fakeRes.status);
      expect(realRes.body).toEqual(fakeRes.body);
    });

    it('rejects a malformed email with 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/password/forgot')
        .send({ email: 'not-an-email' });
      expect(res.status).toBe(400);
    });
  });

  describe('Google-only account exclusion', () => {
    it('never creates a PasswordResetToken for a Google-only (password===null) account, and sends only the instructional notice', async () => {
      const email = uniqueEmail();
      const user = await prisma.user.create({
        data: { name: 'Google Only User', email, password: null, role: 'USER' },
      });

      const res = await request(app.getHttpServer())
        .post('/auth/password/forgot')
        .send({ email });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        message: 'If an account exists for this email, a password reset link has been sent.',
      });

      const tokenCount = await prisma.passwordResetToken.count({
        where: { userId: user.id },
      });
      expect(tokenCount).toBe(0);

      const notice = capturedEmails.find((e) => e.to === email);
      expect(notice).toBeDefined();
      expect(notice!.rendered.html).not.toMatch(/https?:\/\//);
    });
  });

  describe('invalid / expired / consumed token', () => {
    it('rejects an unknown token with a generic 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/password/reset')
        .send({ token: 'this-token-does-not-exist', newPassword: 'irrelevant123' });
      expect(res.status).toBe(400);
    });

    it('rejects a replayed (already-consumed) token with the same generic 400 — no idempotent softening', async () => {
      const { email } = await registerUser();
      await request(app.getHttpServer())
        .post('/auth/password/forgot')
        .send({ email });
      const rawToken = extractResetToken(
        findResetEmail(email)!.rendered,
      );

      const first = await request(app.getHttpServer())
        .post('/auth/password/reset')
        .send({ token: rawToken, newPassword: 'first-new-password-abc' });
      expect(first.status).toBe(201);

      const replay = await request(app.getHttpServer())
        .post('/auth/password/reset')
        .send({ token: rawToken, newPassword: 'second-new-password-xyz' });
      expect(replay.status).toBe(400);
    });
  });

  describe('password-reuse rejection', () => {
    it('returns 409 PASSWORD_REUSE when newPassword equals the current password, and the token remains usable for a retry', async () => {
      const { email } = await registerUser();
      await request(app.getHttpServer())
        .post('/auth/password/forgot')
        .send({ email });
      const rawToken = extractResetToken(
        findResetEmail(email)!.rendered,
      );

      const reuseAttempt = await request(app.getHttpServer())
        .post('/auth/password/reset')
        .send({ token: rawToken, newPassword: 'password123' });
      expect(reuseAttempt.status).toBe(409);
      expect((reuseAttempt.body as { code?: string }).code).toBe(
        'PASSWORD_REUSE',
      );

      const retry = await request(app.getHttpServer())
        .post('/auth/password/reset')
        .send({ token: rawToken, newPassword: 'a-genuinely-different-password' });
      expect(retry.status).toBe(201);
    });
  });

  describe('cross-token invalidation (ADR 006 Invariant 1)', () => {
    it('consumes the pending EmailVerificationToken issued at registration when the reset succeeds', async () => {
      const { email } = await registerUser();
      const user = await prisma.user.findUniqueOrThrow({ where: { email } });

      const verificationTokenBefore =
        await prisma.emailVerificationToken.findFirst({
          where: { userId: user.id, consumedAt: null },
        });
      expect(verificationTokenBefore).not.toBeNull();

      await request(app.getHttpServer())
        .post('/auth/password/forgot')
        .send({ email });
      const rawToken = extractResetToken(
        findResetEmail(email)!.rendered,
      );
      await request(app.getHttpServer())
        .post('/auth/password/reset')
        .send({ token: rawToken, newPassword: 'cross-token-new-password-1' });

      const verificationTokenAfter =
        await prisma.emailVerificationToken.findUnique({
          where: { id: verificationTokenBefore!.id },
        });
      expect(verificationTokenAfter!.consumedAt).not.toBeNull();
    });
  });

  describe('multi-device session revocation (ADR 006)', () => {
    it('revokes every prior refresh session on a successful reset — both an old and a fresh login session stop working', async () => {
      const { email, res: registerRes } = await registerUser();
      const firstDeviceCookie = extractCookieValue(
        registerRes.headers['set-cookie'] as unknown as SetCookieHeader,
        REFRESH_COOKIE_NAME,
      );

      const secondLoginRes = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'password123', role: 'USER' });
      const secondDeviceCookie = extractCookieValue(
        secondLoginRes.headers['set-cookie'] as unknown as SetCookieHeader,
        REFRESH_COOKIE_NAME,
      );

      await request(app.getHttpServer())
        .post('/auth/password/forgot')
        .send({ email });
      const rawToken = extractResetToken(
        findResetEmail(email)!.rendered,
      );
      await request(app.getHttpServer())
        .post('/auth/password/reset')
        .send({ token: rawToken, newPassword: 'multi-device-new-password-2' });

      const firstRefreshAfterReset = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', `${REFRESH_COOKIE_NAME}=${firstDeviceCookie}`);
      expect(firstRefreshAfterReset.status).toBe(401);

      const secondRefreshAfterReset = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', `${REFRESH_COOKIE_NAME}=${secondDeviceCookie}`);
      expect(secondRefreshAfterReset.status).toBe(401);
    });
  });

  describe('no raw secrets anywhere', () => {
    it('stores only a token hash — the raw token from the captured email never appears verbatim in the database', async () => {
      const { email } = await registerUser();
      await request(app.getHttpServer())
        .post('/auth/password/forgot')
        .send({ email });
      const rawToken = extractResetToken(
        findResetEmail(email)!.rendered,
      );

      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      const tokenRow = await prisma.passwordResetToken.findFirst({
        where: { userId: user.id },
      });
      expect(tokenRow).not.toBeNull();
      expect(tokenRow!.tokenHash).not.toBe(rawToken);
      expect(tokenRow!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('the reset password itself is stored only as an argon2 hash', async () => {
      const { email } = await registerUser();
      await request(app.getHttpServer())
        .post('/auth/password/forgot')
        .send({ email });
      const rawToken = extractResetToken(
        findResetEmail(email)!.rendered,
      );
      await request(app.getHttpServer())
        .post('/auth/password/reset')
        .send({ token: rawToken, newPassword: 'no-raw-secrets-password-3' });

      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      expect(user.password).not.toBe('no-raw-secrets-password-3');
      expect(await argon.verify(user.password!, 'no-raw-secrets-password-3')).toBe(
        true,
      );
    });
  });

  describe('rate limiting', () => {
    it('trips 429 on the reset-ip bucket once its configured max is exceeded', async () => {
      // Default AUTH_PASSWORD_RESET_IP_RATE_LIMIT_MAX=20 per 300s — every
      // call counts toward the bucket regardless of outcome (400 for an
      // invalid token still increments it), so 21 rapid invalid-token
      // attempts from this test process's shared IP must trip 429.
      let lastStatus = 0;
      for (let i = 0; i < 21; i++) {
        const res = await request(app.getHttpServer())
          .post('/auth/password/reset')
          .send({ token: `rate-limit-probe-${i}`, newPassword: 'irrelevant123' });
        lastStatus = res.status;
        if (lastStatus === 429) break;
      }
      expect(lastStatus).toBe(429);
    }, 30000);
  });
});
