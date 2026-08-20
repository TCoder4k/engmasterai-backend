import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { SpeakingSessionStore } from './speaking-session.store';

// `ioredis-mock` has no EVAL/Lua support — this suite exercises the real
// append-speaking-turn.lua script against docker-compose.yml's real Redis
// instance, on its own dedicated logical DB (12 — distinct from Chat's 13,
// RateLimiterService's 14 and RefreshTokenService's 15), flushed
// before/after so dev data on DB 0 is untouched. Requires
// `docker-compose up -d` from engmasterai-backend/. Mirrors
// chat-session.store.spec.ts's structure, keyed per (userId, attemptId).
const TEST_REDIS_DB = 12;

const config = (values: Record<string, unknown> = {}): ConfigService =>
  ({
    get: (key: string, fallback?: unknown) => (key in values ? values[key] : fallback),
  }) as unknown as ConfigService;

describe('SpeakingSessionStore (integration — real Redis, atomic bounded append)', () => {
  let redis: Redis;
  let store: SpeakingSessionStore;

  beforeAll(() => {
    redis = new Redis({
      host: process.env.REDIS_HOST ?? 'localhost',
      port: Number(process.env.REDIS_PORT ?? 6379),
      db: TEST_REDIS_DB,
    });
  });

  beforeEach(async () => {
    await redis.flushdb();
    store = new SpeakingSessionStore(redis, config({ SPEAKING_SESSION_TTL_SECONDS: 1800 }));
  });

  afterAll(async () => {
    await redis.flushdb();
    await redis.quit();
  });

  it('a fresh session has no turns', async () => {
    await expect(store.getTurns('user-1', 'attempt-1')).resolves.toEqual([]);
  });

  it('appendTurn stores the user+assistant pair, oldest-first', async () => {
    await store.appendTurn('user-1', 'attempt-1', 'Hello', 'Hi there!');

    const turns = await store.getTurns('user-1', 'attempt-1');
    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({ role: 'user', text: 'Hello' });
    expect(turns[1]).toMatchObject({ role: 'assistant', text: 'Hi there!' });
  });

  it('bounds history to 24 turns (12 exchanges), dropping the OLDEST pair first', async () => {
    for (let i = 1; i <= 13; i += 1) {
      await store.appendTurn('user-1', 'attempt-1', `question ${i}`, `answer ${i}`);
    }

    const turns = await store.getTurns('user-1', 'attempt-1');
    expect(turns).toHaveLength(24);
    // Exchange 1 was dropped; exchange 2 is now the oldest surviving pair.
    expect(turns[0]).toMatchObject({ role: 'user', text: 'question 2' });
    expect(turns[turns.length - 1]).toMatchObject({ role: 'assistant', text: 'answer 13' });
  });

  it('refreshes the TTL on every append (sliding window)', async () => {
    await store.appendTurn('user-1', 'attempt-1', 'first', 'reply');
    await redis.expire('speaking:session:user-1:attempt-1', 5); // artificially shrink it
    await store.appendTurn('user-1', 'attempt-1', 'second', 'reply');

    const ttl = await redis.ttl('speaking:session:user-1:attempt-1');
    expect(ttl).toBeGreaterThan(1700); // back to ~1800, not left at ~5
  });

  it('two DIFFERENT turns appended concurrently for the same attempt never lose one another', async () => {
    // The exact race this Lua script exists to close: a naive
    // GET-modify-SET from Node would let one of these two appends silently
    // overwrite the other. Both must survive.
    await Promise.all([
      store.appendTurn('user-1', 'attempt-1', 'question A', 'answer A'),
      store.appendTurn('user-1', 'attempt-1', 'question B', 'answer B'),
    ]);

    const turns = await store.getTurns('user-1', 'attempt-1');
    expect(turns).toHaveLength(4);
    const texts = turns.map((t) => t.text).sort();
    expect(texts).toEqual(['answer A', 'answer B', 'question A', 'question B'].sort());
  });

  it('clear() removes the session, idempotently', async () => {
    await store.appendTurn('user-1', 'attempt-1', 'Hello', 'Hi there!');

    await store.clear('user-1', 'attempt-1');
    await expect(store.getTurns('user-1', 'attempt-1')).resolves.toEqual([]);
    await expect(store.clear('user-1', 'attempt-1')).resolves.toBeUndefined(); // second call, still a no-op
  });

  it('a session belongs to exactly one (userId, attemptId) pair', async () => {
    await store.appendTurn('user-1', 'attempt-1', 'from attempt 1', 'reply 1');
    await store.appendTurn('user-1', 'attempt-2', 'from attempt 2', 'reply 2');

    const turns1 = await store.getTurns('user-1', 'attempt-1');
    const turns2 = await store.getTurns('user-1', 'attempt-2');
    expect(turns1.map((t) => t.text)).toEqual(['from attempt 1', 'reply 1']);
    expect(turns2.map((t) => t.text)).toEqual(['from attempt 2', 'reply 2']);
  });

  describe('Redis unavailable', () => {
    const brokenClient = () =>
      new Redis({
        host: '127.0.0.1',
        port: 65535,
        lazyConnect: true,
        retryStrategy: () => null,
        maxRetriesPerRequest: 1,
      });

    it('appendTurn fails closed', async () => {
      const broken = brokenClient();
      const brokenStore = new SpeakingSessionStore(broken, config());

      await expect(
        brokenStore.appendTurn('user-1', 'attempt-1', 'q', 'a'),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      broken.disconnect();
    });

    it('getTurns fails closed', async () => {
      const broken = brokenClient();
      const brokenStore = new SpeakingSessionStore(broken, config());

      await expect(brokenStore.getTurns('user-1', 'attempt-1')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      broken.disconnect();
    });

    it('clear fails closed', async () => {
      const broken = brokenClient();
      const brokenStore = new SpeakingSessionStore(broken, config());

      await expect(brokenStore.clear('user-1', 'attempt-1')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      broken.disconnect();
    });
  });
});
