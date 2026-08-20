import Redis from 'ioredis';
import { SpeakingLiveTicketStore } from './speaking-live-ticket.store';

// `ioredis-mock` has no EVAL/Lua support — same reasoning as
// speaking-session.store.spec.ts, this suite exercises the real
// consume-live-ticket.lua script against docker-compose.yml's real Redis
// instance, on its own dedicated logical DB (11 — distinct from Speaking
// session's 12, Chat's 13, RateLimiterService's 14 and RefreshTokenService's
// 15), flushed before/after so dev data on DB 0 is untouched. Requires
// `docker-compose up -d` from engmasterai-backend/.
const TEST_REDIS_DB = 11;

describe('SpeakingLiveTicketStore (integration — real Redis, atomic single-use consume)', () => {
  let redis: Redis;
  let store: SpeakingLiveTicketStore;

  beforeAll(() => {
    redis = new Redis({
      host: process.env.REDIS_HOST ?? 'localhost',
      port: Number(process.env.REDIS_PORT ?? 6379),
      db: TEST_REDIS_DB,
    });
  });

  beforeEach(async () => {
    await redis.flushdb();
    store = new SpeakingLiveTicketStore(redis);
  });

  afterAll(async () => {
    await redis.flushdb();
    await redis.quit();
  });

  it('a freshly issued ticket consumes to the (userId, attemptId) it was issued for', async () => {
    const ticket = await store.issue('user-1', 'attempt-1');

    await expect(store.consume(ticket)).resolves.toEqual({
      userId: 'user-1',
      attemptId: 'attempt-1',
    });
  });

  it('a ticket is SINGLE-USE — the second consume of the same ticket returns null', async () => {
    const ticket = await store.issue('user-1', 'attempt-1');

    await store.consume(ticket);
    await expect(store.consume(ticket)).resolves.toBeNull();
  });

  it('two connections racing to consume the SAME ticket: at most one wins', async () => {
    // The exact race this Lua script exists to close — a naive GET-then-DEL
    // from Node has a gap where two racers could both observe the value
    // still present. EVAL closes it.
    const ticket = await store.issue('user-1', 'attempt-1');

    const [a, b] = await Promise.all([store.consume(ticket), store.consume(ticket)]);
    const winners = [a, b].filter((r) => r !== null);

    expect(winners).toHaveLength(1);
    expect(winners[0]).toEqual({ userId: 'user-1', attemptId: 'attempt-1' });
  });

  it('an unknown ticket returns null', async () => {
    await expect(store.consume('never-issued')).resolves.toBeNull();
  });

  it('an expired ticket returns null', async () => {
    const ticket = await store.issue('user-1', 'attempt-1');
    await redis.expire(`speaking:live-ticket:${ticket}`, 0);

    await expect(store.consume(ticket)).resolves.toBeNull();
  });

  it('different tickets for the same attempt are independent', async () => {
    const ticketA = await store.issue('user-1', 'attempt-1');
    const ticketB = await store.issue('user-1', 'attempt-1');

    await store.consume(ticketA);

    await expect(store.consume(ticketB)).resolves.toEqual({
      userId: 'user-1',
      attemptId: 'attempt-1',
    });
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

    it('issue() fails closed', async () => {
      const broken = brokenClient();
      const brokenStore = new SpeakingLiveTicketStore(broken);

      await expect(brokenStore.issue('user-1', 'attempt-1')).rejects.toThrow(
        'Speaking Live is temporarily unavailable',
      );
      broken.disconnect();
    });

    it('consume() returns null (never throws) so the gateway just rejects the connection', async () => {
      const broken = brokenClient();
      const brokenStore = new SpeakingLiveTicketStore(broken);

      await expect(brokenStore.consume('anything')).resolves.toBeNull();
      broken.disconnect();
    });
  });
});
