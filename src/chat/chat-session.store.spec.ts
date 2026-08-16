import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { ChatSessionStore } from './chat-session.store';

// `ioredis-mock` has no EVAL/Lua support (same reason
// refresh-token.service.spec.ts / rate-limiter.service.spec.ts run against
// real Redis) — this suite exercises the real append-chat-turn.lua script
// against docker-compose.yml's real Redis instance, on its own dedicated
// logical DB (13 — distinct from RateLimiterService's 14 and
// RefreshTokenService's 15, since Jest runs files in separate parallel
// workers and two suites sharing one DB would intermittently wipe each
// other's data mid-test), flushed before/after so dev data on DB 0 is
// untouched. Requires `docker-compose up -d` from engmasterai-backend/.
const TEST_REDIS_DB = 13;

const config = (values: Record<string, unknown> = {}): ConfigService =>
  ({
    get: (key: string, fallback?: unknown) => (key in values ? values[key] : fallback),
  }) as unknown as ConfigService;

describe('ChatSessionStore (integration — real Redis, atomic bounded append)', () => {
  let redis: Redis;
  let store: ChatSessionStore;

  beforeAll(() => {
    redis = new Redis({
      host: process.env.REDIS_HOST ?? 'localhost',
      port: Number(process.env.REDIS_PORT ?? 6379),
      db: TEST_REDIS_DB,
    });
  });

  beforeEach(async () => {
    await redis.flushdb();
    store = new ChatSessionStore(redis, config({ CHAT_SESSION_TTL_SECONDS: 1800 }));
  });

  afterAll(async () => {
    await redis.flushdb();
    await redis.quit();
  });

  it('a fresh session has no turns', async () => {
    await expect(store.getTurns('user-1')).resolves.toEqual([]);
    await expect(store.getSnapshot('user-1')).resolves.toEqual({ turns: [], expiresAt: null });
  });

  it('appendTurn stores the user+assistant pair, oldest-first', async () => {
    await store.appendTurn('user-1', 'Hello', 'Hi there!');

    const turns = await store.getTurns('user-1');
    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({ role: 'user', text: 'Hello' });
    expect(turns[1]).toMatchObject({ role: 'assistant', text: 'Hi there!' });
  });

  it('getSnapshot reports an expiresAt roughly TTL seconds out', async () => {
    await store.appendTurn('user-1', 'Hello', 'Hi there!');

    const snapshot = await store.getSnapshot('user-1');
    expect(snapshot.turns).toHaveLength(2);
    expect(snapshot.expiresAt).not.toBeNull();
    const secondsOut = (new Date(snapshot.expiresAt as string).getTime() - Date.now()) / 1000;
    expect(secondsOut).toBeGreaterThan(1700);
    expect(secondsOut).toBeLessThanOrEqual(1800);
  });

  it('bounds history to 12 turns (6 exchanges), dropping the OLDEST pair first', async () => {
    for (let i = 1; i <= 7; i += 1) {
      await store.appendTurn('user-1', `question ${i}`, `answer ${i}`);
    }

    const turns = await store.getTurns('user-1');
    expect(turns).toHaveLength(12);
    // Exchange 1 was dropped; exchange 2 is now the oldest surviving pair.
    expect(turns[0]).toMatchObject({ role: 'user', text: 'question 2' });
    expect(turns[turns.length - 1]).toMatchObject({ role: 'assistant', text: 'answer 7' });
  });

  it('refreshes the TTL on every append (sliding window)', async () => {
    await store.appendTurn('user-1', 'first', 'reply');
    await redis.expire('chat:session:user-1', 5); // artificially shrink it
    await store.appendTurn('user-1', 'second', 'reply');

    const ttl = await redis.ttl('chat:session:user-1');
    expect(ttl).toBeGreaterThan(1700); // back to ~1800, not left at ~5
  });

  it('two DIFFERENT messages appended concurrently for the same user never lose a turn', async () => {
    // The exact race this Lua script exists to close: a naive
    // GET-modify-SET from Node would let one of these two appends silently
    // overwrite the other. Both must survive.
    await Promise.all([
      store.appendTurn('user-1', 'question A', 'answer A'),
      store.appendTurn('user-1', 'question B', 'answer B'),
    ]);

    const turns = await store.getTurns('user-1');
    expect(turns).toHaveLength(4);
    const texts = turns.map((t) => t.text).sort();
    expect(texts).toEqual(['answer A', 'answer B', 'question A', 'question B'].sort());
  });

  it('clear() removes the session, idempotently', async () => {
    await store.appendTurn('user-1', 'Hello', 'Hi there!');

    await store.clear('user-1');
    await expect(store.getTurns('user-1')).resolves.toEqual([]);
    await expect(store.clear('user-1')).resolves.toBeUndefined(); // second call, still a no-op
  });

  it('a session belongs to exactly one user', async () => {
    await store.appendTurn('user-1', 'from user 1', 'reply 1');
    await store.appendTurn('user-2', 'from user 2', 'reply 2');

    const turns1 = await store.getTurns('user-1');
    const turns2 = await store.getTurns('user-2');
    expect(turns1.map((t) => t.text)).toEqual(['from user 1', 'reply 1']);
    expect(turns2.map((t) => t.text)).toEqual(['from user 2', 'reply 2']);
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
      const brokenStore = new ChatSessionStore(broken, config());

      await expect(brokenStore.appendTurn('user-1', 'q', 'a')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      broken.disconnect();
    });

    it('getTurns fails closed', async () => {
      const broken = brokenClient();
      const brokenStore = new ChatSessionStore(broken, config());

      await expect(brokenStore.getTurns('user-1')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      broken.disconnect();
    });

    it('getSnapshot fails closed', async () => {
      const broken = brokenClient();
      const brokenStore = new ChatSessionStore(broken, config());

      await expect(brokenStore.getSnapshot('user-1')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      broken.disconnect();
    });

    it('clear fails closed', async () => {
      const broken = brokenClient();
      const brokenStore = new ChatSessionStore(broken, config());

      await expect(brokenStore.clear('user-1')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      broken.disconnect();
    });
  });
});
