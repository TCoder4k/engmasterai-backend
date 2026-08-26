import { Prisma } from '@prisma/client';
import { CommunityChatService } from './community-chat.service';
import { CommunityChatGateway } from './live/community-chat.gateway';

const resolve = <T>(value: T) => Promise.resolve(value);

const AUTHOR = { id: 'author-1', name: 'Alice', avatarUrl: null, level: 5 };

const buildHarness = () => {
  const create = jest.fn();
  const findUnique = jest.fn();
  const findMany = jest.fn();
  const count = jest.fn();
  const readStateUpsert = jest.fn();
  const readStateUpdateMany = jest.fn();
  const prisma = {
    communityMessage: { create, findUnique, findMany, count },
    communityReadState: { upsert: readStateUpsert, updateMany: readStateUpdateMany },
  };
  const gateway = { broadcast: jest.fn() } as unknown as CommunityChatGateway;
  const service = new CommunityChatService(prisma as never, gateway);
  return {
    service,
    prisma,
    gateway,
    create,
    findUnique,
    findMany,
    count,
    readStateUpsert,
    readStateUpdateMany,
  };
};

const row = (id: string, createdAt: string, overrides: Record<string, unknown> = {}) => ({
  id,
  content: `content-${id}`,
  clientMessageId: `client-${id}`,
  createdAt: new Date(createdAt),
  user: AUTHOR,
  ...overrides,
});

describe('CommunityChatService.sendMessage', () => {
  it('persists a message via the safe author projection and never leaks fields beyond id/name/avatarUrl/level', async () => {
    const { service, create } = buildHarness();
    create.mockResolvedValue(
      row('msg-1', '2026-01-01T00:00:00.000Z', {
        content: 'hello',
        clientMessageId: 'c1',
        // Simulates a future accidental widening of the Prisma `select` —
        // the DTO mapper must still only ever copy through the four safe
        // fields, never whatever else the row happens to carry.
        user: { ...AUTHOR, email: 'leaked@test.com', role: 'ADMIN', totalPoints: 999 },
      }),
    );

    const result = await service.sendMessage('user-1', 'c1', 'hello');

    expect(result).toEqual({
      id: 'msg-1',
      content: 'hello',
      clientMessageId: 'c1',
      createdAt: '2026-01-01T00:00:00.000Z',
      author: { id: 'author-1', name: 'Alice', avatarUrl: null, level: 5 },
    });
    expect(create).toHaveBeenCalledWith({
      data: { userId: 'user-1', clientMessageId: 'c1', content: 'hello' },
      include: { user: { select: { id: true, name: true, avatarUrl: true, level: true } } },
    });
  });

  it('broadcasts exactly once on a first-time send', async () => {
    const { service, create, gateway } = buildHarness();
    create.mockResolvedValue(row('msg-1', '2026-01-01T00:00:00.000Z', { content: 'hi', clientMessageId: 'c1' }));

    await service.sendMessage('user-1', 'c1', 'hi');

    expect(gateway.broadcast).toHaveBeenCalledTimes(1);
    expect(gateway.broadcast).toHaveBeenCalledWith(expect.objectContaining({ id: 'msg-1', content: 'hi' }));
  });

  it('a retried send with the same (userId, clientMessageId) returns the original row and does not create a duplicate or re-broadcast', async () => {
    const { service, create, findUnique, gateway } = buildHarness();
    const p2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
    });
    create.mockRejectedValue(p2002);
    findUnique.mockResolvedValue(row('msg-1', '2026-01-01T00:00:00.000Z', { content: 'hi', clientMessageId: 'c1' }));

    const result = await service.sendMessage('user-1', 'c1', 'hi');

    expect(result.id).toBe('msg-1');
    expect(findUnique).toHaveBeenCalledWith({
      where: { userId_clientMessageId: { userId: 'user-1', clientMessageId: 'c1' } },
      include: { user: { select: { id: true, name: true, avatarUrl: true, level: true } } },
    });
    expect(gateway.broadcast).not.toHaveBeenCalled();
  });

  it('propagates a non-P2002 error rather than swallowing it', async () => {
    const { service, create } = buildHarness();
    create.mockRejectedValue(new Error('connection lost'));

    await expect(service.sendMessage('user-1', 'c1', 'hi')).rejects.toThrow('connection lost');
  });
});

describe('CommunityChatService.listMessages', () => {
  it('returns the most recent page, oldest -> newest, when no cursor is given', async () => {
    const { service, findMany } = buildHarness();
    // The service queries DESC (newest first); the mock mirrors that.
    findMany.mockReturnValue(
      resolve([
        row('3', '2026-01-03T00:00:00.000Z'),
        row('2', '2026-01-02T00:00:00.000Z'),
        row('1', '2026-01-01T00:00:00.000Z'),
      ]),
    );

    const result = await service.listMessages(undefined, 3);

    expect(result.data.map((m) => m.id)).toEqual(['1', '2', '3']);
    expect(result.meta).toEqual({ hasMore: false, oldestId: '1' });
  });

  it('hasMore is true exactly when limit+1 rows come back, and the extra row is trimmed', async () => {
    const { service, findMany } = buildHarness();
    findMany.mockReturnValue(
      resolve([
        row('4', '2026-01-04T00:00:00.000Z'),
        row('3', '2026-01-03T00:00:00.000Z'),
        row('2', '2026-01-02T00:00:00.000Z'),
        row('1', '2026-01-01T00:00:00.000Z'), // the +1 boundary row, must be trimmed
      ]),
    );

    const result = await service.listMessages(undefined, 3);

    expect(result.data.map((m) => m.id)).toEqual(['2', '3', '4']);
    expect(result.meta).toEqual({ hasMore: true, oldestId: '2' });
  });

  it('a `before` cursor resolves the anchor row then queries strictly older rows, returned oldest -> newest', async () => {
    const { service, findMany, findUnique } = buildHarness();
    findUnique.mockResolvedValue({ id: 'anchor', createdAt: new Date('2026-01-05T00:00:00.000Z') });
    findMany.mockReturnValue(
      resolve([row('2', '2026-01-02T00:00:00.000Z'), row('1', '2026-01-01T00:00:00.000Z')]),
    );

    const result = await service.listMessages('anchor', 10);

    expect(result.data.map((m) => m.id)).toEqual(['1', '2']);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { createdAt: { lt: new Date('2026-01-05T00:00:00.000Z') } },
            { createdAt: new Date('2026-01-05T00:00:00.000Z'), id: { lt: 'anchor' } },
          ],
        },
      }),
    );
  });

  it('an unresolvable `before` id returns an empty page, not an error', async () => {
    const { service, findUnique, findMany } = buildHarness();
    findUnique.mockResolvedValue(null);

    const result = await service.listMessages('missing-id', 10);

    expect(result).toEqual({ data: [], meta: { hasMore: false, oldestId: null } });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('an empty result set reports hasMore:false and oldestId:null, not a thrown error', async () => {
    const { service, findMany } = buildHarness();
    findMany.mockReturnValue(resolve([]));

    const result = await service.listMessages(undefined, 10);

    expect(result).toEqual({ data: [], meta: { hasMore: false, oldestId: null } });
  });
});

describe('CommunityChatService.unreadCount', () => {
  it('lazily upserts a read-state row, then counts messages from OTHER users strictly after lastReadAt', async () => {
    const { service, readStateUpsert, count } = buildHarness();
    const lastReadAt = new Date('2026-01-01T00:00:00.000Z');
    readStateUpsert.mockResolvedValue({ userId: 'user-1', lastReadAt });
    count.mockResolvedValue(2);

    const result = await service.unreadCount('user-1');

    expect(result).toBe(2);
    expect(readStateUpsert).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      update: {},
      create: { userId: 'user-1' },
    });
    expect(count).toHaveBeenCalledWith({
      where: { userId: { not: 'user-1' }, createdAt: { gt: lastReadAt } },
    });
  });

  it('a brand-new user (no prior row) is not charged for pre-existing history — the upsert create branch starts the cursor at "now"', async () => {
    const { service, readStateUpsert, count } = buildHarness();
    // Simulates the create branch firing (no row existed): upsert resolves
    // with whatever lastReadAt Prisma's own @default(now()) produced.
    const justNow = new Date();
    readStateUpsert.mockResolvedValue({ userId: 'user-2', lastReadAt: justNow });
    count.mockResolvedValue(0);

    const result = await service.unreadCount('user-2');

    expect(result).toBe(0);
  });
});

describe('CommunityChatService.markRead', () => {
  it('advances the cursor via the conditional updateMany and does NOT also call upsert when it succeeds', async () => {
    const { service, readStateUpdateMany, readStateUpsert } = buildHarness();
    readStateUpdateMany.mockResolvedValue({ count: 1 });

    await service.markRead('user-1');

    expect(readStateUpdateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', lastReadAt: { lt: expect.any(Date) as Date } },
      data: { lastReadAt: expect.any(Date) as Date },
    });
    expect(readStateUpsert).not.toHaveBeenCalled();
  });

  it('falls back to upsert (create) when updateMany matches nothing because no row exists yet', async () => {
    const { service, readStateUpdateMany, readStateUpsert } = buildHarness();
    readStateUpdateMany.mockResolvedValue({ count: 0 });
    readStateUpsert.mockResolvedValue({ userId: 'user-1', lastReadAt: new Date() });

    await service.markRead('user-1');

    expect(readStateUpsert).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      update: {},
      create: { userId: 'user-1', lastReadAt: expect.any(Date) as Date },
    });
  });

  it('monotonic cursor: when updateMany matches nothing because a later call already advanced past this call\'s timestamp, the upsert fallback is a true no-op (update: {}), never regressing lastReadAt', async () => {
    const { service, readStateUpdateMany, readStateUpsert } = buildHarness();
    // count:0 here represents BOTH possible reasons (no row yet, or the row
    // is already >= now) — the fix is that the fallback's `update: {}`
    // never writes a stale timestamp over a newer one in either case.
    readStateUpdateMany.mockResolvedValue({ count: 0 });
    readStateUpsert.mockResolvedValue({ userId: 'user-1', lastReadAt: new Date('2099-01-01') });

    await service.markRead('user-1');

    const upsertCall = readStateUpsert.mock.calls[0][0] as { update: unknown };
    expect(upsertCall.update).toEqual({});
  });
});
