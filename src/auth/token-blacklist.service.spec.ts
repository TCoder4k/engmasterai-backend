import RedisMock from 'ioredis-mock';
import type Redis from 'ioredis';
import { ServiceUnavailableException } from '@nestjs/common';
import { TokenBlacklistService } from './token-blacklist.service';
import { AuthEventLogger } from './logging/auth-event-logger.service';

// ioredis-mock ships no TypeScript types of its own; its runtime API
// mirrors ioredis's real Redis class closely enough (get/set/keys/flushall)
// to type it as one for the purposes of this test.
describe('TokenBlacklistService', () => {
  let redis: Redis;
  let service: TokenBlacklistService;

  beforeEach(() => {
    redis = new RedisMock() as unknown as Redis;
    const authEventLogger = { log: jest.fn() } as unknown as AuthEventLogger;
    service = new TokenBlacklistService(redis, authEventLogger);
  });

  afterEach(async () => {
    await redis.flushall();
  });

  it('a freshly-blacklisted token is reported as blacklisted', async () => {
    const token = 'sample.jwt.token';
    const expiresAt = Math.floor(Date.now() / 1000) + 60;

    await service.addToBlacklist(token, expiresAt);

    await expect(service.isBlacklisted(token)).resolves.toBe(true);
  });

  it('a token that was never blacklisted is reported as not blacklisted', async () => {
    await expect(service.isBlacklisted('never-added.jwt.token')).resolves.toBe(
      false,
    );
  });

  it('an already-expired token is not written to the blacklist (nothing to revoke)', async () => {
    const token = 'already-expired.jwt.token';
    const expiresAt = Math.floor(Date.now() / 1000) - 10; // in the past

    await service.addToBlacklist(token, expiresAt);

    await expect(service.isBlacklisted(token)).resolves.toBe(false);
  });

  it('a blacklist entry expires after its TTL', async () => {
    const token = 'short-lived.jwt.token';
    const expiresAt = Math.floor(Date.now() / 1000) + 1;

    await service.addToBlacklist(token, expiresAt);
    await expect(service.isBlacklisted(token)).resolves.toBe(true);

    // ioredis-mock honors EX-based TTLs against a virtual clock; advance
    // past expiry rather than sleeping the real test process.
    jest
      .useFakeTimers({ advanceTimers: true })
      .setSystemTime(Date.now() + 2000);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    jest.useRealTimers();

    await expect(service.isBlacklisted(token)).resolves.toBe(false);
  }, 10000);

  it('stores only a hash of the token, never the raw value', async () => {
    const token = 'raw-token-should-not-appear-in-redis';
    const expiresAt = Math.floor(Date.now() / 1000) + 60;

    await service.addToBlacklist(token, expiresAt);

    const keys = await redis.keys('auth:atbl:*');
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toContain(token);

    const value = await redis.get(keys[0]);
    expect(value).not.toBe(token);
  });

  it('surfaces a Redis failure on write as ServiceUnavailableException (fail closed, not open)', async () => {
    jest.spyOn(redis, 'set').mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await expect(
      service.addToBlacklist('token', Math.floor(Date.now() / 1000) + 60),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('surfaces a Redis failure on read as ServiceUnavailableException, never a silent pass', async () => {
    jest.spyOn(redis, 'get').mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await expect(service.isBlacklisted('token')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
