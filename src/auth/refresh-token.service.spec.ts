import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { RefreshTokenService } from './refresh-token.service';
import { AuthEventLogger } from './logging/auth-event-logger.service';

// `ioredis-mock` does not implement EVAL/Lua scripting (confirmed: no
// eval/cjson support in its command set), so it cannot exercise the real
// atomic rotation script this service depends on. These tests run against
// docker-compose.yml's real Redis instance instead, on a dedicated logical
// DB (15) that is flushed before/after so it never touches dev data on DB 0.
// Requires `docker-compose up -d` from engmasterai-backend/.
const TEST_REDIS_DB = 15;

interface StoredFamilyRecord {
  userId: string;
  currentSecretHash: string;
  createdAt: number;
  lastUsedAt: number;
  userAgent: string | null;
}

describe('RefreshTokenService (integration — real Redis, strict single-use rotation)', () => {
  let redis: Redis;
  let service: RefreshTokenService;
  const config = {
    get: (_key: string, defaultValue?: string) => defaultValue,
  } as unknown as ConfigService;
  const authEventLogger = { log: jest.fn() } as unknown as AuthEventLogger;

  beforeAll(() => {
    redis = new Redis({
      host: process.env.REDIS_HOST ?? 'localhost',
      port: Number(process.env.REDIS_PORT ?? 6379),
      db: TEST_REDIS_DB,
    });
  });

  beforeEach(async () => {
    await redis.flushdb();
    service = new RefreshTokenService(redis, config, authEventLogger);
  });

  afterAll(async () => {
    await redis.flushdb();
    await redis.quit();
  });

  it('issue() creates a family record with only a secret hash — no plaintext, no removed fields', async () => {
    const { familyId, secret } = await service.issue('user-1', 'jest-agent');
    expect(familyId).toBeTruthy();
    expect(secret).toBeTruthy();

    const raw = await redis.get(`auth:refresh:family:${familyId}`);
    expect(raw).not.toBeNull();
    const record = JSON.parse(raw as string) as StoredFamilyRecord;

    expect(record.userId).toBe('user-1');
    expect(record.currentSecretHash).toBeTruthy();
    expect(record.currentSecretHash).not.toBe(secret);
    expect(JSON.stringify(record)).not.toContain(secret);
    expect(record).not.toHaveProperty('previousSecretHash');
    expect(record).not.toHaveProperty('previousRotatedAt');
    expect(record).not.toHaveProperty('revoked');
  });

  it('rotate() with the correct current secret succeeds and the stored hash changes', async () => {
    const { familyId, secret } = await service.issue('user-2', null);

    const result = await service.rotate(familyId, secret);

    expect(result.outcome).toBe('ok');
    expect(result.secret).toBeTruthy();
    expect(result.secret).not.toBe(secret);
    expect(result.userId).toBe('user-2');

    const raw = await redis.get(`auth:refresh:family:${familyId}`);
    const record = JSON.parse(raw as string) as StoredFamilyRecord;
    expect(JSON.stringify(record)).not.toContain(result.secret);
  });

  it('strict single-use: presenting the same (now-stale) secret again fails and revokes the family', async () => {
    const { familyId, secret } = await service.issue('user-3', null);

    const first = await service.rotate(familyId, secret);
    expect(first.outcome).toBe('ok');

    // Reusing the ORIGINAL (already-rotated-away) secret — no grace window.
    const second = await service.rotate(familyId, secret);
    expect(second.outcome).toBe('reused');

    const raw = await redis.get(`auth:refresh:family:${familyId}`);
    expect(raw).toBeNull(); // whole family gone, not just the stale secret rejected

    // Even the legitimate, latest secret from the first rotation is now dead.
    const third = await service.rotate(familyId, first.secret as string);
    expect(third.outcome).toBe('missing');
  });

  it('rotate() against a non-existent family returns "missing", not an error', async () => {
    const result = await service.rotate(
      'no-such-family-id',
      'irrelevant-secret',
    );
    expect(result.outcome).toBe('missing');
  });

  it('revoke() deletes the family outright and is idempotent', async () => {
    const { familyId } = await service.issue('user-4', null);

    await service.revoke(familyId);
    expect(await redis.get(`auth:refresh:family:${familyId}`)).toBeNull();

    await expect(service.revoke(familyId)).resolves.not.toThrow();
  });

  it('two concurrent rotate() calls against the same starting secret: exactly one succeeds, the other is reuse-revoked', async () => {
    const { familyId, secret } = await service.issue('user-5', null);

    const [a, b] = await Promise.all([
      service.rotate(familyId, secret),
      service.rotate(familyId, secret),
    ]);

    const outcomes = [a.outcome, b.outcome].sort();
    expect(outcomes).toEqual(['ok', 'reused']);

    // The "winner"'s brand-new token is also dead afterward — reuse
    // detection revoked the family atomically inside the same script call
    // that produced the win.
    const winner = a.outcome === 'ok' ? a : b;
    const followUp = await service.rotate(familyId, winner.secret as string);
    expect(followUp.outcome).toBe('missing');
  });

  // Sprint 02C / ADR 006 — the per-user index enabling revokeAllForUser().
  describe('per-user session index (ADR 006)', () => {
    it('issue() adds the new family to the per-user index SET', async () => {
      const { familyId } = await service.issue('user-7', null);
      const members = await redis.smembers('auth:refresh:user:user-7');
      expect(members).toEqual([familyId]);
    });

    it('revoke() removes the family from the per-user index SET too', async () => {
      const { familyId } = await service.issue('user-8', null);
      await service.revoke(familyId);
      const members = await redis.smembers('auth:refresh:user:user-8');
      expect(members).toEqual([]);
    });

    it('revoke() on an already-gone family is still idempotent (no record to read, SREM skipped)', async () => {
      await expect(service.revoke('no-such-family')).resolves.not.toThrow();
    });

    it('revokeAllForUser() deletes every family for that user and clears the index', async () => {
      const a = await service.issue('user-9', 'agent-a');
      const b = await service.issue('user-9', 'agent-b');
      const c = await service.issue('user-9', 'agent-c');

      await service.revokeAllForUser('user-9');

      expect(await redis.get(`auth:refresh:family:${a.familyId}`)).toBeNull();
      expect(await redis.get(`auth:refresh:family:${b.familyId}`)).toBeNull();
      expect(await redis.get(`auth:refresh:family:${c.familyId}`)).toBeNull();
      expect(await redis.smembers('auth:refresh:user:user-9')).toEqual([]);

      // Every revoked family fails a subsequent rotate() as "missing", not
      // silently succeeding.
      expect((await service.rotate(a.familyId, a.secret)).outcome).toBe(
        'missing',
      );
    });

    it('revokeAllForUser() does not touch another user\'s sessions', async () => {
      const mine = await service.issue('user-10', null);
      const other = await service.issue('user-11', null);

      await service.revokeAllForUser('user-10');

      expect(await redis.get(`auth:refresh:family:${mine.familyId}`)).toBeNull();
      expect(
        await redis.get(`auth:refresh:family:${other.familyId}`),
      ).not.toBeNull();
    });

    it('revokeAllForUser() for a user with no sessions is a harmless no-op', async () => {
      await expect(
        service.revokeAllForUser('user-with-no-sessions'),
      ).resolves.not.toThrow();
    });

    it('revokeAllForUser() surfaces a Redis failure as ServiceUnavailableException, never silently succeeding', async () => {
      const brokenRedis = new Redis({
        host: '127.0.0.1',
        port: 65535,
        lazyConnect: true,
        retryStrategy: () => null,
        maxRetriesPerRequest: 1,
      });
      const brokenService = new RefreshTokenService(
        brokenRedis,
        config,
        authEventLogger,
      );

      await expect(
        brokenService.revokeAllForUser('user-12'),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);

      brokenRedis.disconnect();
    });
  });

  it('a Redis connection failure surfaces as ServiceUnavailableException, not a silent pass', async () => {
    const brokenRedis = new Redis({
      host: '127.0.0.1',
      port: 65535,
      lazyConnect: true,
      retryStrategy: () => null,
      maxRetriesPerRequest: 1,
    });
    const brokenService = new RefreshTokenService(
      brokenRedis,
      config,
      authEventLogger,
    );

    await expect(brokenService.issue('user-6', null)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    brokenRedis.disconnect();
  });
});
