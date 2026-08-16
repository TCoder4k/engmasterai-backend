import RedisMock from 'ioredis-mock';
import type Redis from 'ioredis';
import { ServiceUnavailableException } from '@nestjs/common';
import { ChatIdempotencyStore } from './chat-idempotency.store';

// ioredis-mock implements plain commands (SET/GET/DEL, including the
// NX/EX option combination this store relies on) without needing Lua/EVAL
// support — unlike ChatSessionStore's append-chat-turn.lua, claim() never
// does a read-modify-write from Node, so there is no atomicity gap for a
// mock to fail to reproduce. See chat-session.store.spec.ts for why THAT
// store instead runs as a real-Redis integration test.
describe('ChatIdempotencyStore', () => {
  let redis: Redis;
  let store: ChatIdempotencyStore;

  beforeEach(() => {
    redis = new RedisMock() as unknown as Redis;
    store = new ChatIdempotencyStore(redis);
  });

  afterEach(async () => {
    await redis.flushall();
  });

  it('the first caller for a clientMessageId claims it', async () => {
    const result = await store.claim('user-1', 'msg-1', 120);
    expect(result).toEqual({ outcome: 'claimed' });
  });

  it('a second, concurrent claim for the SAME clientMessageId eventually sees the committed reply instead of claiming', async () => {
    await store.claim('user-1', 'msg-1', 120);
    // Simulates the winner committing its result WHILE the racer is still
    // in its poll loop.
    await store.commit('user-1', 'msg-1', 'Hello!', '2026-01-01T00:00:00.000Z', 1800);

    const racer = await store.claim('user-1', 'msg-1', 120);

    expect(racer).toEqual({
      outcome: 'done',
      reply: 'Hello!',
      repliedAt: '2026-01-01T00:00:00.000Z',
    });
  }, 10000);

  it('a replay AFTER the original already committed returns the same reply, without re-claiming', async () => {
    await store.claim('user-1', 'msg-1', 120);
    await store.commit('user-1', 'msg-1', 'Xin chào!', '2026-01-01T00:00:00.000Z', 1800);

    const replay = await store.claim('user-1', 'msg-1', 120);

    expect(replay).toEqual({
      outcome: 'done',
      reply: 'Xin chào!',
      repliedAt: '2026-01-01T00:00:00.000Z',
    });
  }, 10000);

  it('a claim that stays pending for the whole poll budget is reported as a conflict', async () => {
    await store.claim('user-1', 'msg-1', 120); // never committed — simulates a still-in-flight owner

    const racer = await store.claim('user-1', 'msg-1', 120);

    expect(racer).toEqual({ outcome: 'conflict' });
  }, 10000);

  it('releasing a claim lets a genuine retry re-claim the same clientMessageId', async () => {
    await store.claim('user-1', 'msg-1', 120);
    await store.release('user-1', 'msg-1');

    const retry = await store.claim('user-1', 'msg-1', 120);

    expect(retry).toEqual({ outcome: 'claimed' });
  });

  it('different clientMessageIds for the same user claim independently', async () => {
    const first = await store.claim('user-1', 'msg-1', 120);
    const second = await store.claim('user-1', 'msg-2', 120);

    expect(first).toEqual({ outcome: 'claimed' });
    expect(second).toEqual({ outcome: 'claimed' });
  });

  it('fails closed when Redis errors while claiming', async () => {
    jest.spyOn(redis, 'set').mockRejectedValue(new Error('connection lost'));

    await expect(store.claim('user-1', 'msg-1', 120)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('fails closed when Redis errors while committing', async () => {
    await store.claim('user-1', 'msg-1', 120);
    jest.spyOn(redis, 'set').mockRejectedValue(new Error('connection lost'));

    await expect(
      store.commit('user-1', 'msg-1', 'reply', '2026-01-01T00:00:00.000Z', 1800),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('release() never throws even if the underlying Redis DEL fails — it only logs', async () => {
    await store.claim('user-1', 'msg-1', 120);
    jest.spyOn(redis, 'del').mockRejectedValue(new Error('connection lost'));

    await expect(store.release('user-1', 'msg-1')).resolves.toBeUndefined();
  });
});
