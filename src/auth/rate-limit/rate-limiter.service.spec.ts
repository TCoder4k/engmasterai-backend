import Redis from 'ioredis';
import { ServiceUnavailableException } from '@nestjs/common';
import { RateLimiterService } from './rate-limiter.service';

// `ioredis-mock` has no EVAL/Lua support (same reason
// refresh-token.service.spec.ts runs against real Redis) — this suite
// exercises the real rate-limit-incr.lua script against docker-compose.yml's
// real Redis instance, on its own dedicated logical DB (14 — deliberately
// NOT 15, which refresh-token.service.spec.ts already uses; Jest runs test
// files in separate parallel workers by default, and two suites sharing one
// DB with their own flushdb() calls would intermittently wipe each other's
// data mid-test), flushed before/after so dev data on DB 0 is untouched.
const TEST_REDIS_DB = 14;

describe('RateLimiterService (integration — real Redis, atomic fixed-window counter)', () => {
  let redis: Redis;
  let service: RateLimiterService;

  beforeAll(() => {
    redis = new Redis({
      host: process.env.REDIS_HOST ?? 'localhost',
      port: Number(process.env.REDIS_PORT ?? 6379),
      db: TEST_REDIS_DB,
    });
  });

  beforeEach(async () => {
    await redis.flushdb();
    service = new RateLimiterService(redis);
  });

  afterAll(async () => {
    await redis.flushdb();
    await redis.quit();
  });

  it('allows requests under the max and increments the counter each time', async () => {
    const key = 'test:rl:under-max';

    const first = await service.checkAndIncrement(key, 3, 60);
    expect(first).toEqual({ allowed: true, count: 1 });

    const second = await service.checkAndIncrement(key, 3, 60);
    expect(second).toEqual({ allowed: true, count: 2 });
  });

  it('rejects the request that crosses the max', async () => {
    const key = 'test:rl:over-max';

    await service.checkAndIncrement(key, 2, 60);
    await service.checkAndIncrement(key, 2, 60);
    const third = await service.checkAndIncrement(key, 2, 60);

    expect(third).toEqual({ allowed: false, count: 3 });
  });

  it('sets a TTL only on the first increment — later increments do not reset it', async () => {
    const key = 'test:rl:ttl-once';

    await service.checkAndIncrement(key, 10, 100);
    const ttlAfterFirst = await redis.ttl(key);
    expect(ttlAfterFirst).toBeGreaterThan(0);
    expect(ttlAfterFirst).toBeLessThanOrEqual(100);

    // Force the TTL down to prove a second increment does NOT reset it back
    // toward 100 (a fixed window has one fixed start/end, not a sliding one).
    await redis.expire(key, 5);
    await service.checkAndIncrement(key, 10, 100);
    const ttlAfterSecond = await redis.ttl(key);
    expect(ttlAfterSecond).toBeGreaterThan(0);
    expect(ttlAfterSecond).toBeLessThanOrEqual(5);
  });

  it('independent keys do not interfere with each other', async () => {
    const keyA = 'test:rl:independent-a';
    const keyB = 'test:rl:independent-b';

    await service.checkAndIncrement(keyA, 1, 60);
    const resultA = await service.checkAndIncrement(keyA, 1, 60);
    const resultB = await service.checkAndIncrement(keyB, 1, 60);

    expect(resultA.allowed).toBe(false);
    expect(resultB.allowed).toBe(true);
  });

  it('concurrent increments against the same key resolve atomically — no lost updates', async () => {
    const key = 'test:rl:concurrent';

    const results = await Promise.all(
      Array.from({ length: 10 }, () => service.checkAndIncrement(key, 100, 60)),
    );

    const counts = results.map((r) => r.count).sort((a, b) => a - b);
    expect(counts).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('a Redis connection failure surfaces as ServiceUnavailableException, not a silent allow', async () => {
    const brokenRedis = new Redis({
      host: '127.0.0.1',
      port: 65535,
      lazyConnect: true,
      retryStrategy: () => null,
      maxRetriesPerRequest: 1,
    });
    const brokenService = new RateLimiterService(brokenRedis);

    await expect(
      brokenService.checkAndIncrement('test:rl:broken', 5, 60),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    brokenRedis.disconnect();
  });
});
