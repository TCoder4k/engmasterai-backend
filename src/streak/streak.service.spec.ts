import { StreakService } from './streak.service';
import { formatDayInTimeZone } from '../analytics/day-window';

// Streak Together — StreakService against a small in-memory fake Prisma,
// same "mock the datastore, not the framework" technique as
// gamification.service.spec.ts / quiz.service.spec.ts's own $transaction
// mocking convention ($transaction: jest.fn((fn) => fn(tx))).
//
// A hand-rolled fake (not per-call jest.fn() return scripting) because
// acceptInvitation/onUserActivityDay read back rows they just wrote in the
// SAME test (upsert-then-read, create-then-updateMany-then-read) — scripting
// each call's return value individually would drift from what the real
// Prisma calls actually see.

interface FakeUser {
  id: string;
  name: string;
  avatarUrl: string | null;
  level: number;
  timezone: string | null;
  totalPoints: number;
}

interface FakeInvitation {
  id: string;
  inviterId: string;
  inviteeId: string;
  status: string;
  createdAt: Date;
  respondedAt: Date | null;
  expiresAt: Date;
}

interface FakePair {
  id: string;
  userLowId: string;
  userHighId: string;
  status: string;
  currentStreak: number;
  longestStreak: number;
  startedAt: Date;
  lastQualifiedDay: string | null;
  publicShareId: string | null;
  updatedAt: Date;
}

interface FakeDailyActivity {
  userId: string;
  day: Date; // UTC midnight of the calendar day, same encoding as dayKeyToDate
}

let idCounter = 0;
const nextId = (prefix: string) => `${prefix}-${(idCounter += 1)}`;

const toDayDate = (label: string): Date => {
  const [y, m, d] = label.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

const userSelect = (u: FakeUser) => ({
  id: u.id,
  name: u.name,
  avatarUrl: u.avatarUrl,
  level: u.level,
  totalPoints: u.totalPoints,
});

class FakeStore {
  users: FakeUser[] = [];
  invitations: FakeInvitation[] = [];
  pairs: FakePair[] = [];
  dailyActivity: FakeDailyActivity[] = [];
  notifications: { userId: string; type: string; payload: unknown }[] = [];

  addUser(over: Partial<FakeUser> = {}): FakeUser {
    const user: FakeUser = {
      id: nextId('user'),
      name: 'User',
      avatarUrl: null,
      level: 1,
      timezone: 'UTC',
      totalPoints: 0,
      ...over,
    };
    this.users.push(user);
    return user;
  }

  addQualifiedDay(userId: string, dayLabel: string): void {
    this.dailyActivity.push({ userId, day: toDayDate(dayLabel) });
  }

  withPairInclude(pair: FakePair) {
    const low = this.users.find((u) => u.id === pair.userLowId)!;
    const high = this.users.find((u) => u.id === pair.userHighId)!;
    return { ...pair, userLow: userSelect(low), userHigh: userSelect(high) };
  }

  withInvitationInclude(inv: FakeInvitation) {
    const inviter = this.users.find((u) => u.id === inv.inviterId)!;
    const invitee = this.users.find((u) => u.id === inv.inviteeId)!;
    return { ...inv, inviter: userSelect(inviter), invitee: userSelect(invitee) };
  }
}

const buildPrismaClient = (store: FakeStore) => {
  const client = {
    user: {
      findUnique: jest.fn(({ where: { id } }: { where: { id: string } }) =>
        Promise.resolve(store.users.find((u) => u.id === id) ? { id } : null),
      ),
      findUniqueOrThrow: jest.fn(({ where: { id } }: { where: { id: string } }) => {
        const u = store.users.find((row) => row.id === id);
        if (!u) throw new Error('not found');
        return Promise.resolve({ timezone: u.timezone });
      }),
    },
    streakInvitation: {
      create: jest.fn(
        ({
          data,
        }: {
          data: { inviterId: string; inviteeId: string; expiresAt: Date };
        }) => {
          const row: FakeInvitation = {
            id: nextId('inv'),
            inviterId: data.inviterId,
            inviteeId: data.inviteeId,
            status: 'PENDING',
            createdAt: new Date(),
            respondedAt: null,
            expiresAt: data.expiresAt,
          };
          store.invitations.push(row);
          return Promise.resolve(store.withInvitationInclude(row));
        },
      ),
      findFirst: jest.fn(({ where }: { where: { status?: string; OR?: unknown[]; respondedAt?: { gte: Date } } }) => {
        const matches = store.invitations.filter((inv) => matchInvitationWhere(inv, where));
        return Promise.resolve(matches[0] ? store.withInvitationInclude(matches[0]) : null);
      }),
      findMany: jest.fn(({ where }: { where: Record<string, unknown> }) => {
        const matches = store.invitations.filter((inv) => matchInvitationWhere(inv, where));
        return Promise.resolve(matches.map((inv) => store.withInvitationInclude(inv)));
      }),
      findUnique: jest.fn(({ where: { id } }: { where: { id: string } }) => {
        const row = store.invitations.find((inv) => inv.id === id);
        return Promise.resolve(row ? store.withInvitationInclude(row) : null);
      }),
      updateMany: jest.fn(
        ({ where, data }: { where: { id: string; status: string }; data: Partial<FakeInvitation> }) => {
          const row = store.invitations.find((inv) => inv.id === where.id && inv.status === where.status);
          if (!row) return Promise.resolve({ count: 0 });
          Object.assign(row, data);
          return Promise.resolve({ count: 1 });
        },
      ),
    },
    streakPair: {
      findUnique: jest.fn(
        ({
          where,
          select,
        }: {
          where: { id?: string; userLowId_userHighId?: { userLowId: string; userHighId: string }; publicShareId?: string };
          select?: unknown;
        }) => {
          let row: FakePair | undefined;
          if (where.id) row = store.pairs.find((p) => p.id === where.id);
          else if (where.userLowId_userHighId)
            row = store.pairs.find(
              (p) =>
                p.userLowId === where.userLowId_userHighId!.userLowId &&
                p.userHighId === where.userLowId_userHighId!.userHighId,
            );
          else if (where.publicShareId) row = store.pairs.find((p) => p.publicShareId === where.publicShareId);
          if (!row) return Promise.resolve(null);
          if (select) {
            const low = store.users.find((u) => u.id === row!.userLowId)!;
            const high = store.users.find((u) => u.id === row!.userHighId)!;
            return Promise.resolve({
              currentStreak: row.currentStreak,
              status: row.status,
              startedAt: row.startedAt,
              userLow: { name: low.name, avatarUrl: low.avatarUrl },
              userHigh: { name: high.name, avatarUrl: high.avatarUrl },
            });
          }
          return Promise.resolve(store.withPairInclude(row));
        },
      ),
      findMany: jest.fn(
        ({
          where,
          orderBy,
          take,
        }: {
          where: Record<string, unknown>;
          orderBy?: Record<string, 'asc' | 'desc'>[];
          take?: number;
        }) => {
          let matches = store.pairs.filter((p) => matchPairWhere(p, where));
          if (orderBy) {
            matches = [...matches].sort((a, b) => {
              for (const clause of orderBy) {
                const [field, dir] = Object.entries(clause)[0] as [keyof FakePair, 'asc' | 'desc'];
                const av = a[field] as number;
                const bv = b[field] as number;
                if (av !== bv) return dir === 'desc' ? bv - av : av - bv;
              }
              return 0;
            });
          }
          if (typeof take === 'number') matches = matches.slice(0, take);
          return Promise.resolve(matches.map((p) => store.withPairInclude(p)));
        },
      ),
      count: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(store.pairs.filter((p) => matchPairWhere(p, where)).length),
      ),
      upsert: jest.fn(
        ({
          where,
          create,
          update,
        }: {
          where: { userLowId_userHighId: { userLowId: string; userHighId: string } };
          create: { userLowId: string; userHighId: string; status: string };
          update: Partial<FakePair>;
        }) => {
          const key = where.userLowId_userHighId;
          let row = store.pairs.find((p) => p.userLowId === key.userLowId && p.userHighId === key.userHighId);
          if (row) {
            Object.assign(row, update);
          } else {
            row = {
              id: nextId('pair'),
              userLowId: create.userLowId,
              userHighId: create.userHighId,
              status: create.status,
              currentStreak: 0,
              longestStreak: 0,
              startedAt: new Date(),
              lastQualifiedDay: null,
              publicShareId: null,
              updatedAt: new Date(),
            };
            store.pairs.push(row);
          }
          return Promise.resolve(store.withPairInclude(row));
        },
      ),
      update: jest.fn(({ where: { id }, data }: { where: { id: string }; data: Partial<FakePair> }) => {
        const row = store.pairs.find((p) => p.id === id)!;
        Object.assign(row, data);
        return Promise.resolve(store.withPairInclude(row));
      }),
    },
    userDailyActivity: {
      findMany: jest.fn(({ where }: { where: { userId: string; day: { gte: Date } } }) =>
        Promise.resolve(
          store.dailyActivity
            .filter((row) => row.userId === where.userId && row.day.getTime() >= where.day.gte.getTime())
            .map((row) => ({ day: row.day })),
        ),
      ),
      findUnique: jest.fn(
        ({ where: { userId_day } }: { where: { userId_day: { userId: string; day: Date } } }) => {
          const row = store.dailyActivity.find(
            (r) => r.userId === userId_day.userId && r.day.getTime() === userId_day.day.getTime(),
          );
          return Promise.resolve(row ? { userId: row.userId, day: row.day } : null);
        },
      ),
    },
    lessonStepProgress: { findFirst: jest.fn(() => Promise.resolve(null)) },
    lessonTaskAttempt: { findFirst: jest.fn(() => Promise.resolve(null)) },
    wordReviewLog: { findFirst: jest.fn(() => Promise.resolve(null)) },
    listeningDictationAttempt: {
      findFirst: jest.fn<Promise<{ submittedAt: Date } | null>, []>(() => Promise.resolve(null)),
    },
    listeningShadowingAttempt: {
      findFirst: jest.fn<Promise<{ submittedAt: Date } | null>, []>(() => Promise.resolve(null)),
    },
    $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn(client)),
  };
  return client;
};

const matchInvitationWhere = (inv: FakeInvitation, where: Record<string, unknown>): boolean => {
  if (where.status && inv.status !== where.status) return false;
  if (where.respondedAt) {
    const gte = (where.respondedAt as { gte: Date }).gte;
    if (!inv.respondedAt || inv.respondedAt.getTime() < gte.getTime()) return false;
  }
  if (where.inviterId && inv.inviterId !== where.inviterId) return false;
  if (where.inviteeId && inv.inviteeId !== where.inviteeId) return false;
  if (where.OR) {
    const or = where.OR as Record<string, unknown>[];
    return or.some((clause) => matchInvitationWhere(inv, { ...clause, status: where.status, respondedAt: where.respondedAt }));
  }
  return true;
};

const matchPairWhere = (pair: FakePair, where: Record<string, unknown>): boolean => {
  if (where.status && pair.status !== where.status) return false;
  if (where.userLowId && pair.userLowId !== where.userLowId) return false;
  if (where.userHighId && pair.userHighId !== where.userHighId) return false;
  if (where.currentStreak) {
    const gte = (where.currentStreak as { gte: number }).gte;
    if (pair.currentStreak < gte) return false;
  }
  if (where.OR) {
    const or = where.OR as Record<string, unknown>[];
    return or.some((clause) => matchPairWhere(pair, { ...clause, status: where.status }));
  }
  return true;
};

const buildHarness = () => {
  const store = new FakeStore();
  const prisma = buildPrismaClient(store);
  const notifications = { create: jest.fn(() => Promise.resolve()) };
  const service = new StreakService(prisma as never, notifications as never);
  return { store, prisma, notifications, service };
};

describe('StreakService — invitations', () => {
  it('rejects a self-invitation', async () => {
    const { service, store } = buildHarness();
    const a = store.addUser();
    await expect(service.sendInvitation(a.id, a.id)).rejects.toThrow();
  });

  it('rejects inviting an unknown user', async () => {
    const { service, store } = buildHarness();
    const a = store.addUser();
    await expect(service.sendInvitation(a.id, 'nope')).rejects.toThrow();
  });

  it('rejects a duplicate PENDING invite in either direction', async () => {
    const { service, store } = buildHarness();
    const a = store.addUser();
    const b = store.addUser();
    await service.sendInvitation(a.id, b.id);
    await expect(service.sendInvitation(a.id, b.id)).rejects.toThrow();
    await expect(service.sendInvitation(b.id, a.id)).rejects.toThrow();
  });

  it('enforces a cooldown after a DECLINE', async () => {
    const { service, store } = buildHarness();
    const a = store.addUser();
    const b = store.addUser();
    const invite = await service.sendInvitation(a.id, b.id);
    await service.declineInvitation(b.id, invite.id);
    await expect(service.sendInvitation(a.id, b.id)).rejects.toThrow();
  });

  it('a second accept attempt on the same invitation is rejected (race guard)', async () => {
    const { service, store } = buildHarness();
    const a = store.addUser();
    const b = store.addUser();
    const invite = await service.sendInvitation(a.id, b.id);
    await service.acceptInvitation(b.id, invite.id);
    await expect(service.acceptInvitation(b.id, invite.id)).rejects.toThrow();
  });

  it('notifies the invitee when an invitation is sent', async () => {
    const { service, store, notifications } = buildHarness();
    const a = store.addUser();
    const b = store.addUser();
    const invite = await service.sendInvitation(a.id, b.id);
    expect(notifications.create).toHaveBeenCalledWith(
      expect.anything(),
      b.id,
      'STREAK_INVITATION_RECEIVED',
      expect.objectContaining({ partnerId: a.id, invitationId: invite.id }),
    );
  });

  it('only the invitee can accept, and only the inviter can cancel', async () => {
    const { service, store } = buildHarness();
    const a = store.addUser();
    const b = store.addUser();
    const invite = await service.sendInvitation(a.id, b.id);
    await expect(service.acceptInvitation(a.id, invite.id)).rejects.toThrow();
    await expect(service.cancelInvitation(b.id, invite.id)).rejects.toThrow();
  });

  it('accepting creates an ACTIVE pair with canonical (low, high) ordering regardless of who invited', async () => {
    const { service, store } = buildHarness();
    const a = store.addUser({ id: 'zzz' });
    const b = store.addUser({ id: 'aaa' });
    // b < a lexicographically — b invites a, so the inviter is the HIGH id.
    const invite = await service.sendInvitation(b.id, a.id);
    const pair = await service.acceptInvitation(a.id, invite.id);
    expect(pair.status).toBe('ACTIVE');
    expect(store.pairs[0].userLowId).toBe('aaa');
    expect(store.pairs[0].userHighId).toBe('zzz');
  });

  it('notifies the inviter when their invitation is accepted', async () => {
    const { service, store, notifications } = buildHarness();
    const a = store.addUser();
    const b = store.addUser();
    const invite = await service.sendInvitation(a.id, b.id);
    await service.acceptInvitation(b.id, invite.id);
    expect(notifications.create).toHaveBeenCalledWith(
      expect.anything(),
      a.id,
      'STREAK_INVITATION_ACCEPTED',
      expect.objectContaining({ partnerId: b.id }),
    );
  });

  it('restarting a BROKEN pair preserves longestStreak', async () => {
    const { service, store } = buildHarness();
    const a = store.addUser({ id: 'aaa' });
    const b = store.addUser({ id: 'bbb' });
    const invite1 = await service.sendInvitation(a.id, b.id);
    await service.acceptInvitation(b.id, invite1.id);
    store.pairs[0].status = 'BROKEN';
    store.pairs[0].longestStreak = 9;
    store.pairs[0].currentStreak = 0;

    const invite2 = await service.sendInvitation(a.id, b.id);
    const restarted = await service.acceptInvitation(b.id, invite2.id);
    expect(restarted.status).toBe('ACTIVE');
    expect(restarted.longestStreak).toBe(9);
    expect(store.pairs).toHaveLength(1);
  });
});

describe('StreakService — getPairStatus', () => {
  it('reports none, then pending_sent/pending_received, then active', async () => {
    const { service, store } = buildHarness();
    const a = store.addUser();
    const b = store.addUser();

    expect((await service.getPairStatus(a.id, b.id)).relationship).toBe('none');

    const invite = await service.sendInvitation(a.id, b.id);
    expect((await service.getPairStatus(a.id, b.id)).relationship).toBe('pending_sent');
    expect((await service.getPairStatus(b.id, a.id)).relationship).toBe('pending_received');

    await service.acceptInvitation(b.id, invite.id);
    expect((await service.getPairStatus(a.id, b.id)).relationship).toBe('active');
  });
});

describe('StreakService — onUserActivityDay', () => {
  const activePair = async () => {
    const { service, store, prisma, notifications } = buildHarness();
    const a = store.addUser({ id: 'aaa' });
    const b = store.addUser({ id: 'bbb' });
    const invite = await service.sendInvitation(a.id, b.id);
    await service.acceptInvitation(b.id, invite.id);
    return { service, store, prisma, notifications, a, b };
  };

  it('nudges the partner (does not increment) when only one side has qualified today', async () => {
    const { service, store, prisma, notifications, a, b } = await activePair();
    await service.onUserActivityDay(prisma as never, a.id, '2026-08-24');
    expect(store.pairs[0].currentStreak).toBe(0);
    expect(notifications.create).toHaveBeenCalledWith(
      expect.anything(),
      b.id,
      'STREAK_PARTNER_ACTIVE',
      expect.objectContaining({ partnerId: a.id }),
    );
  });

  it('qualifies the day once BOTH sides have activity, starting the streak at 1', async () => {
    const { service, store, prisma, a, b } = await activePair();
    store.addQualifiedDay(b.id, '2026-08-24');
    await service.onUserActivityDay(prisma as never, a.id, '2026-08-24');
    expect(store.pairs[0].currentStreak).toBe(1);
    expect(store.pairs[0].lastQualifiedDay).toBe('2026-08-24');
  });

  it('is idempotent — the same day being re-processed does not double-increment', async () => {
    const { service, store, prisma, a, b } = await activePair();
    store.addQualifiedDay(b.id, '2026-08-24');
    await service.onUserActivityDay(prisma as never, a.id, '2026-08-24');
    // b's own activity that same day fires the hook again with the same label.
    await service.onUserActivityDay(prisma as never, b.id, '2026-08-24');
    expect(store.pairs[0].currentStreak).toBe(1);
  });

  it('increments on the immediate next consecutive day', async () => {
    const { service, store, prisma, a, b } = await activePair();
    store.pairs[0].lastQualifiedDay = '2026-08-23';
    store.pairs[0].currentStreak = 5;
    store.pairs[0].longestStreak = 5;
    store.addQualifiedDay(b.id, '2026-08-24');
    await service.onUserActivityDay(prisma as never, a.id, '2026-08-24');
    expect(store.pairs[0].currentStreak).toBe(6);
    expect(store.pairs[0].longestStreak).toBe(6);
  });

  it('fires a milestone notification for the very first mutually qualified day', async () => {
    const { service, store, prisma, notifications, a, b } = await activePair();
    store.addQualifiedDay(b.id, '2026-08-24');
    await service.onUserActivityDay(prisma as never, a.id, '2026-08-24');
    expect(notifications.create).toHaveBeenCalledWith(
      expect.anything(),
      a.id,
      'STREAK_MILESTONE',
      expect.objectContaining({ days: 1 }),
    );
  });

  it('fires a milestone notification exactly at day 3', async () => {
    const { service, store, prisma, notifications, a, b } = await activePair();
    store.pairs[0].lastQualifiedDay = '2026-08-23';
    store.pairs[0].currentStreak = 2;
    store.addQualifiedDay(b.id, '2026-08-24');
    await service.onUserActivityDay(prisma as never, a.id, '2026-08-24');
    expect(notifications.create).toHaveBeenCalledWith(
      expect.anything(),
      a.id,
      'STREAK_MILESTONE',
      expect.objectContaining({ days: 3 }),
    );
  });

  it('breaks the streak when more than one full day was missed, and resets currentStreak', async () => {
    const { service, store, prisma, notifications, a, b } = await activePair();
    store.pairs[0].lastQualifiedDay = '2026-08-20';
    store.pairs[0].currentStreak = 5;
    store.pairs[0].longestStreak = 5;
    await service.onUserActivityDay(prisma as never, a.id, '2026-08-24');
    expect(store.pairs[0].status).toBe('BROKEN');
    expect(store.pairs[0].currentStreak).toBe(0);
    expect(store.pairs[0].longestStreak).toBe(5);
    expect(notifications.create).toHaveBeenCalledWith(expect.anything(), a.id, 'STREAK_BROKEN', expect.anything());
    expect(notifications.create).toHaveBeenCalledWith(expect.anything(), b.id, 'STREAK_BROKEN', expect.anything());
  });

  it('ignores a day label that is already behind the recorded high-water mark', async () => {
    const { service, store, prisma, a } = await activePair();
    store.pairs[0].lastQualifiedDay = '2026-08-24';
    store.pairs[0].currentStreak = 4;
    await service.onUserActivityDay(prisma as never, a.id, '2026-08-23');
    expect(store.pairs[0].currentStreak).toBe(4);
    expect(store.pairs[0].status).toBe('ACTIVE');
  });

  it('does nothing for a BROKEN pair', async () => {
    const { service, store, prisma, a } = await activePair();
    store.pairs[0].status = 'BROKEN';
    store.pairs[0].lastQualifiedDay = '2026-08-01';
    await service.onUserActivityDay(prisma as never, a.id, '2026-08-24');
    expect(store.pairs[0].currentStreak).toBe(0);
  });
});

describe('StreakService — getLeaderboard', () => {
  const acceptedPairWithStreak = async (currentStreak: number, longestStreak = currentStreak, points = 0) => {
    const { service, store } = buildHarness();
    const a = store.addUser({ totalPoints: points });
    const b = store.addUser({ totalPoints: points });
    const invite = await service.sendInvitation(a.id, b.id);
    await service.acceptInvitation(b.id, invite.id);
    store.pairs[0].currentStreak = currentStreak;
    store.pairs[0].longestStreak = longestStreak;
    return { service, store, a, b };
  };

  it('ranks active pairs by currentStreak, highest first', async () => {
    const { service, store, a } = await acceptedPairWithStreak(5);
    // A second, unrelated pair with a higher streak.
    const c = store.addUser();
    const d = store.addUser();
    const invite2 = await service.sendInvitation(c.id, d.id);
    await service.acceptInvitation(d.id, invite2.id);
    store.pairs[1].currentStreak = 12;

    const board = await service.getLeaderboard(a.id);

    expect(board.map((row) => row.currentStreak)).toEqual([12, 5]);
    expect(board[0].rank).toBe(1);
    expect(board[1].rank).toBe(2);
  });

  it('breaks a tie in currentStreak by longestStreak', async () => {
    const { service, store, a } = await acceptedPairWithStreak(10, 10);
    const c = store.addUser();
    const d = store.addUser();
    const invite2 = await service.sendInvitation(c.id, d.id);
    await service.acceptInvitation(d.id, invite2.id);
    store.pairs[1].currentStreak = 10;
    store.pairs[1].longestStreak = 40;

    const board = await service.getLeaderboard(a.id);

    expect(board[0].longestStreak).toBe(40);
    expect(board[1].longestStreak).toBe(10);
  });

  it('excludes a BROKEN pair even if it once had a long streak', async () => {
    const { service, store, a } = await acceptedPairWithStreak(50);
    store.pairs[0].status = 'BROKEN';

    const board = await service.getLeaderboard(a.id);

    expect(board).toHaveLength(0);
  });

  it('excludes a pair that has never had a qualifying day (currentStreak 0)', async () => {
    const { service, a } = await acceptedPairWithStreak(0);

    const board = await service.getLeaderboard(a.id);

    expect(board).toHaveLength(0);
  });

  it('sums both members\' real totalPoints into totalXp — no fabricated stat', async () => {
    const { service, a } = await acceptedPairWithStreak(5, 5, 300);

    const board = await service.getLeaderboard(a.id);

    expect(board[0].totalXp).toBe(600);
  });

  it('flags the viewer\'s own pair and no one else\'s', async () => {
    const { service, a } = await acceptedPairWithStreak(5);
    const stranger = 'not-a-participant';

    const [mine] = await service.getLeaderboard(a.id);
    const [asStranger] = await service.getLeaderboard(stranger);

    expect(mine.isCurrentUserPair).toBe(true);
    expect(asStranger.isCurrentUserPair).toBe(false);
  });
});

describe('StreakService — getStreakDetail activity-today labeling', () => {
  // Dictation/Shadowing attempts count as a qualifying activity day
  // (activity-window.ts), but describeActivity() re-derives "today" from raw
  // tables rather than reusing collectActiveDays — so it needs its own
  // coverage to confirm a listening-only day is not silently missed.
  const acceptedPair = async () => {
    const { service, store, prisma } = buildHarness();
    const a = store.addUser({ id: 'aaa' });
    const b = store.addUser({ id: 'bbb' });
    const invite = await service.sendInvitation(a.id, b.id);
    await service.acceptInvitation(b.id, invite.id);
    return { service, store, prisma, a, b };
  };

  it('labels a listening-only day as qualified, with the shared "listening" label', async () => {
    const { service, store, prisma, a } = await acceptedPair();
    prisma.listeningDictationAttempt.findFirst.mockResolvedValueOnce({ submittedAt: new Date() });

    const detail = await service.getStreakDetail(a.id, store.pairs[0].id);

    expect(detail.meActivityToday).toEqual({
      qualified: true,
      label: 'listening',
      at: expect.any(String),
    });
  });

  it('reports not-yet-qualified when neither lesson, practice, vocab nor listening happened today', async () => {
    const { service, store, a } = await acceptedPair();

    const detail = await service.getStreakDetail(a.id, store.pairs[0].id);

    expect(detail.meActivityToday).toEqual({ qualified: false, label: null, at: null });
  });
});

describe('StreakService — self-healing recompute on read', () => {
  // Repro of a real reported bug: both partners had already completed a
  // qualifying activity today BEFORE the pair was created (e.g. accepting
  // the invite later in the day) — recordProgress's isNewDay gate only
  // fires onUserActivityDay on a user's FIRST qualifying action of the day,
  // so neither side's activity re-triggers it after the fact, and
  // currentStreak was staying stuck at 0 forever despite both "Đã học hôm
  // nay ✓". getStreakDetail/listMyStreaks must self-heal this on read.
  const acceptedPair = async () => {
    const { service, store, notifications } = buildHarness();
    const a = store.addUser({ id: 'aaa' });
    const b = store.addUser({ id: 'bbb' });
    const invite = await service.sendInvitation(a.id, b.id);
    await service.acceptInvitation(b.id, invite.id);
    return { service, store, notifications, a, b };
  };

  it('self-heals currentStreak when both partners already qualified today before the write-side hook could fire', async () => {
    const { service, store, a, b } = await acceptedPair();
    const today = formatDayInTimeZone(new Date(), 'UTC');
    store.addQualifiedDay(a.id, today);
    store.addQualifiedDay(b.id, today);

    const detail = await service.getStreakDetail(a.id, store.pairs[0].id);

    expect(detail.currentStreak).toBe(1);
    expect(detail.longestStreak).toBe(1);
    expect(store.pairs[0].lastQualifiedDay).toBe(today);
  });

  it('does not double-increment when the detail page is viewed twice on the same qualified day', async () => {
    const { service, store, a, b } = await acceptedPair();
    const today = formatDayInTimeZone(new Date(), 'UTC');
    store.addQualifiedDay(a.id, today);
    store.addQualifiedDay(b.id, today);

    await service.getStreakDetail(a.id, store.pairs[0].id);
    const second = await service.getStreakDetail(a.id, store.pairs[0].id);

    expect(second.currentStreak).toBe(1);
  });

  it('self-heals a break on read too, when a real gap exists and someone has since qualified again', async () => {
    const { service, store, a } = await acceptedPair();
    store.pairs[0].lastQualifiedDay = '2020-01-01';
    store.pairs[0].currentStreak = 5;
    store.pairs[0].longestStreak = 5;
    const today = formatDayInTimeZone(new Date(), 'UTC');
    store.addQualifiedDay(a.id, today);

    const detail = await service.getStreakDetail(a.id, store.pairs[0].id);

    expect(detail.status).toBe('BROKEN');
    expect(detail.currentStreak).toBe(0);
    expect(detail.longestStreak).toBe(5);
  });

  it('does not spam a "partner active" notification on repeated detail reads — only the live hook does that', async () => {
    const { service, store, notifications, a, b } = await acceptedPair();
    const today = formatDayInTimeZone(new Date(), 'UTC');
    store.addQualifiedDay(a.id, today); // only "a" has gone today

    await service.getStreakDetail(a.id, store.pairs[0].id);
    await service.getStreakDetail(a.id, store.pairs[0].id);
    await service.getStreakDetail(b.id, store.pairs[0].id);

    expect(notifications.create).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'STREAK_PARTNER_ACTIVE',
      expect.anything(),
    );
    expect(store.pairs[0].currentStreak).toBe(0);
  });

  it('listMyStreaks also self-heals currentStreak for an ACTIVE pair', async () => {
    const { service, store, a, b } = await acceptedPair();
    const today = formatDayInTimeZone(new Date(), 'UTC');
    store.addQualifiedDay(a.id, today);
    store.addQualifiedDay(b.id, today);

    const rows = await service.listMyStreaks(a.id);

    expect(rows[0].currentStreak).toBe(1);
  });

  it('leaves a BROKEN pair untouched by the recompute', async () => {
    const { service, store, a } = await acceptedPair();
    store.pairs[0].status = 'BROKEN';
    store.pairs[0].currentStreak = 0;
    const today = formatDayInTimeZone(new Date(), 'UTC');
    store.addQualifiedDay(a.id, today);

    const detail = await service.getStreakDetail(a.id, store.pairs[0].id);

    expect(detail.status).toBe('BROKEN');
    expect(detail.currentStreak).toBe(0);
  });
});

describe('StreakService — public sharing', () => {
  it('generates a share id lazily and returns the same one on a second call', async () => {
    const { service, store } = buildHarness();
    const a = store.addUser();
    const b = store.addUser();
    const invite = await service.sendInvitation(a.id, b.id);
    const pair = await service.acceptInvitation(b.id, invite.id);
    expect(pair.publicShareId).toBeNull();

    const first = await service.generateShareLink(a.id, pair.id);
    const second = await service.generateShareLink(a.id, pair.id);
    expect(first.shareId).toBe(second.shareId);
  });

  it('rejects a non-participant from generating a share link', async () => {
    const { service, store } = buildHarness();
    const a = store.addUser();
    const b = store.addUser();
    const stranger = store.addUser();
    const invite = await service.sendInvitation(a.id, b.id);
    const pair = await service.acceptInvitation(b.id, invite.id);
    await expect(service.generateShareLink(stranger.id, pair.id)).rejects.toThrow();
  });

  it('the public payload never includes ids, level, or any authenticated-only field', async () => {
    const { service, store } = buildHarness();
    const a = store.addUser({ name: 'Alice', level: 9 });
    const b = store.addUser({ name: 'Bob', level: 4 });
    const invite = await service.sendInvitation(a.id, b.id);
    const pair = await service.acceptInvitation(b.id, invite.id);
    const { shareId } = await service.generateShareLink(a.id, pair.id);

    const publicView = await service.getPublicStreak(shareId);
    expect(publicView).toEqual({
      currentStreak: 0,
      status: 'ACTIVE',
      startedAt: expect.any(String),
      userA: { name: expect.any(String), avatarUrl: null },
      userB: { name: expect.any(String), avatarUrl: null },
    });
    expect(JSON.stringify(publicView)).not.toMatch(/level|"id"/);
  });

  it('404s for an unknown share id', async () => {
    const { service } = buildHarness();
    await expect(service.getPublicStreak('does-not-exist')).rejects.toThrow();
  });
});
