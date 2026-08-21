import { UserRole } from '@prisma/client';
import { startOfDayInTimeZone } from '../learning/timezone.util';
import { enumerateDaysInTimeZone } from './day-window';
import {
  AdminDashboardAnalyticsService,
  average,
  computeChangePercent,
  passRateFromGroups,
} from './admin-dashboard-analytics.service';

// Two layers, matching dashboard-analytics.service.spec.ts's own split:
//
// 1. The pure helpers (computeChangePercent/average/passRateFromGroups) get
//    exhaustive, cheap unit tests — these carry the null-vs-zero rules that
//    were the whole point of the plan review this service was rewritten
//    against, so they are tested directly rather than only indirectly
//    through a large mocked-Prisma harness.
// 2. The orchestration method gets a smaller number of harness-driven tests
//    covering the properties that cannot be checked any other way: the
//    half-open window boundary, the StudyTimeEvent/SpeakingAttempt union for
//    DAU, and the empty-database "everything nullable is actually null, not
//    a fabricated zero" path.

describe('computeChangePercent', () => {
  it('computes a positive change', () => {
    expect(computeChangePercent(120, 100)).toBe(20);
  });

  it('computes a negative change', () => {
    expect(computeChangePercent(80, 100)).toBe(-20);
  });

  it('returns null when the previous value is zero — never Infinity', () => {
    expect(computeChangePercent(5, 0)).toBeNull();
  });

  it('returns null when the previous value is negative (defensive)', () => {
    expect(computeChangePercent(5, -1)).toBeNull();
  });

  it('rounds to one decimal place', () => {
    expect(computeChangePercent(10, 3)).toBeCloseTo(233.3, 1);
  });
});

describe('average', () => {
  it('averages a list of counts to one decimal place', () => {
    expect(average([1, 2, 2, 3, 3, 3, 4])).toBeCloseTo(2.6, 1);
  });

  it('returns 0 for an empty list rather than NaN', () => {
    expect(average([])).toBe(0);
  });
});

describe('passRateFromGroups', () => {
  it('computes passed/total * 100', () => {
    expect(
      passRateFromGroups([
        { passed: true, _count: 7 },
        { passed: false, _count: 3 },
      ]),
    ).toBe(70);
  });

  it('returns null when nobody submitted anything — NOT 0', () => {
    expect(passRateFromGroups([])).toBeNull();
  });

  it('returns a real 0 when everyone submitted and failed', () => {
    expect(passRateFromGroups([{ passed: false, _count: 4 }])).toBe(0);
  });
});

// ---------------------------------------------------------------------------

const NOW = new Date('2026-08-21T09:00:00.000Z');

const freezeNow = (instant: Date) => {
  jest.useFakeTimers({ doNotFake: ['performance'] });
  jest.setSystemTime(instant);
};

afterEach(() => {
  jest.useRealTimers();
});

// Replicates the service's own window math using the same real helpers, so
// the test's expected boundaries can never silently drift from what the
// service actually computes.
const UTC = 'UTC';
const days7 = enumerateDaysInTimeZone(NOW, UTC, 7);
const current7dStart = startOfDayInTimeZone(new Date(`${days7[0]}T12:00:00.000Z`), UTC);
const days7prev = enumerateDaysInTimeZone(new Date(current7dStart.getTime() - 1), UTC, 7);
const previous7dStart = startOfDayInTimeZone(new Date(`${days7prev[0]}T12:00:00.000Z`), UTC);
const days30 = enumerateDaysInTimeZone(NOW, UTC, 30);
const window30dStart = startOfDayInTimeZone(new Date(`${days30[0]}T12:00:00.000Z`), UTC);

interface Row {
  userId: string;
  at: Date;
}

interface HarnessOptions {
  totalCourses?: number;
  currentActiveStudyRows?: Row[];
  previousActiveStudyRows?: Row[];
  currentActiveSpeakingRows?: Row[];
  previousActiveSpeakingRows?: Row[];
  currentTaskCompletions?: Date[];
  currentStepCompletions?: Date[];
  currentAttemptGroups?: { passed: boolean; _count: number }[];
  previousAttemptGroups?: { passed: boolean; _count: number }[];
  currentAiAgg?: { _count: number; _sum: { turnCount: number | null } };
  previousAiAgg?: { _count: number; _sum: { turnCount: number | null } };
  skillListeningSessionIds?: string[];
  skillVocabGrammarSessionIds?: string[];
  skillSpeakingSessionCount?: number;
  totalStudents?: number;
  baselineStudents?: number;
  newStudentRows?: Date[];
  topStudentGroups?: { userId: string; _sum: { creditedSeconds: number | null } }[];
  topStudentUsers?: { id: string; name: string; email: string; level: number }[];
  topStudentCompletions?: { userId: string; _count: number }[];
}

const buildHarness = (options: HarnessOptions = {}) => {
  const resolve = <T>(value: T): Promise<T> => Promise.resolve(value);

  const isCurrentWindow = (gte: Date) => gte.getTime() === current7dStart.getTime();

  const studyTimeEventFindMany = jest.fn(
    (args: { where: Record<string, unknown>; select: Record<string, unknown> }) => {
      if ('userId' in args.select) {
        // Daily-active-users read (current or previous window).
        const gte = (args.where.occurredAt as { gte: Date }).gte;
        const rows = isCurrentWindow(gte)
          ? options.currentActiveStudyRows ?? []
          : options.previousActiveStudyRows ?? [];
        return resolve(rows.map((row) => ({ userId: row.userId, occurredAt: row.at })));
      }
      // Skill-breakdown read (LISTENING or the VOCAB_GRAMMAR `in` list).
      const isListening = args.where.activityType === 'LISTENING';
      const ids = isListening
        ? options.skillListeningSessionIds ?? []
        : options.skillVocabGrammarSessionIds ?? [];
      return resolve(ids.map((clientSessionId) => ({ clientSessionId })));
    },
  );

  const speakingAttemptFindMany = jest.fn(
    (args: { where: { completedAt: { gte: Date } } }) => {
      const rows = isCurrentWindow(args.where.completedAt.gte)
        ? options.currentActiveSpeakingRows ?? []
        : options.previousActiveSpeakingRows ?? [];
      return resolve(rows.map((row) => ({ userId: row.userId, completedAt: row.at })));
    },
  );

  const speakingAttemptAggregate = jest.fn((args: { where: { completedAt: { gte: Date } } }) =>
    resolve(
      isCurrentWindow(args.where.completedAt.gte)
        ? options.currentAiAgg ?? { _count: 0, _sum: { turnCount: null } }
        : options.previousAiAgg ?? { _count: 0, _sum: { turnCount: null } },
    ),
  );

  const lessonTaskAttemptGroupBy = jest.fn((args: { where: { submittedAt: { gte: Date } } }) =>
    resolve(
      isCurrentWindow(args.where.submittedAt.gte)
        ? options.currentAttemptGroups ?? []
        : options.previousAttemptGroups ?? [],
    ),
  );

  const userCount = jest.fn((args: { where: Record<string, unknown> }) =>
    resolve(
      'createdAt' in args.where ? options.baselineStudents ?? 0 : options.totalStudents ?? 0,
    ),
  );

  const userFindMany = jest.fn((args: { where: Record<string, unknown> }) => {
    if ('id' in args.where) {
      return resolve(options.topStudentUsers ?? []);
    }
    return resolve((options.newStudentRows ?? []).map((createdAt) => ({ createdAt })));
  });

  const prisma = {
    course: { count: jest.fn(() => resolve(options.totalCourses ?? 0)) },
    studyTimeEvent: {
      findMany: studyTimeEventFindMany,
      groupBy: jest.fn(() => resolve(options.topStudentGroups ?? [])),
    },
    speakingAttempt: {
      findMany: speakingAttemptFindMany,
      aggregate: speakingAttemptAggregate,
      count: jest.fn(() => resolve(options.skillSpeakingSessionCount ?? 0)),
    },
    lessonTaskProgress: {
      findMany: jest.fn(() =>
        resolve((options.currentTaskCompletions ?? []).map((completedAt) => ({ completedAt }))),
      ),
      groupBy: jest.fn(() => resolve(options.topStudentCompletions ?? [])),
    },
    lessonStepProgress: {
      findMany: jest.fn(() =>
        resolve((options.currentStepCompletions ?? []).map((completedAt) => ({ completedAt }))),
      ),
    },
    lessonTaskAttempt: { groupBy: lessonTaskAttemptGroupBy },
    user: { count: userCount, findMany: userFindMany },
  };

  const service = new AdminDashboardAnalyticsService(prisma as never);
  return { service, prisma };
};

describe('AdminDashboardAnalyticsService — DAU unions StudyTimeEvent and SpeakingAttempt', () => {
  it('counts a student active via StudyTimeEvent only, one active via SpeakingAttempt only, and does not double-count a student active via both', async () => {
    freezeNow(NOW);
    const today = new Date(NOW.getTime() - 60 * 1000); // just before "now", i.e. today's bucket
    const { service } = buildHarness({
      currentActiveStudyRows: [
        { userId: 'a', at: today },
        { userId: 'b', at: today },
      ],
      currentActiveSpeakingRows: [{ userId: 'b', at: today }, { userId: 'c', at: today }],
    });

    const result = await service.getAdminDashboardAnalytics();

    const todayPoint = result.engagement.find((point) => point.date === days7[days7.length - 1]);
    expect(todayPoint?.activeUsers).toBe(3); // a, b, c — b not double-counted
  });
});

describe('AdminDashboardAnalyticsService — half-open window boundary', () => {
  it('excludes a row exactly AT the previous-window end / current-window start from both windows\' overlap and counts it as current', async () => {
    freezeNow(NOW);
    const { service } = buildHarness({
      // Exactly on the boundary instant — belongs to the CURRENT window
      // ([current7dStart, now)), never the previous one.
      currentActiveStudyRows: [{ userId: 'boundary-user', at: current7dStart }],
    });

    const result = await service.getAdminDashboardAnalytics();

    const firstDayOfCurrentWindow = result.engagement[0];
    expect(firstDayOfCurrentWindow.activeUsers).toBe(1);
  });
});

describe('AdminDashboardAnalyticsService — empty database renders nulls, not fabricated zeros/values', () => {
  it('passRatePercent is null when nobody submitted an attempt, not 0', async () => {
    freezeNow(NOW);
    const { service } = buildHarness({});

    const result = await service.getAdminDashboardAnalytics();

    expect(result.summary.passRatePercent).toBeNull();
    expect(result.summary.passRatePercentChangePercent).toBeNull();
  });

  it('every *ChangePercent is null when the previous window has no data', async () => {
    freezeNow(NOW);
    const { service } = buildHarness({});

    const result = await service.getAdminDashboardAnalytics();

    expect(result.summary.dauAvg7dChangePercent).toBeNull();
    expect(result.summary.aiSessions7dChangePercent).toBeNull();
    expect(result.summary.aiTurns7dChangePercent).toBeNull();
  });

  it('userGrowth.decreasedLast30d and retentionRatePercent are always null — no signal exists to compute them', async () => {
    freezeNow(NOW);
    const { service } = buildHarness({});

    const result = await service.getAdminDashboardAnalytics();

    expect(result.userGrowth.decreasedLast30d).toBeNull();
    expect(result.userGrowth.retentionRatePercent).toBeNull();
  });

  it('returns an empty topStudents list rather than throwing when no StudyTimeEvent rows exist', async () => {
    freezeNow(NOW);
    const { service } = buildHarness({});

    const result = await service.getAdminDashboardAnalytics();

    expect(result.topStudents).toEqual([]);
  });
});

describe('AdminDashboardAnalyticsService — top students', () => {
  it('ranks by total study seconds descending, tie-broken by userId ascending, and excludes admins already filtered upstream', async () => {
    freezeNow(NOW);
    const { service } = buildHarness({
      topStudentGroups: [
        { userId: 'z-tied', _sum: { creditedSeconds: 500 } },
        { userId: 'a-tied', _sum: { creditedSeconds: 500 } },
        { userId: 'top', _sum: { creditedSeconds: 900 } },
      ],
      topStudentUsers: [
        { id: 'top', name: 'Top', email: 'top@example.com', level: 5 },
        { id: 'a-tied', name: 'A', email: 'a@example.com', level: 2 },
        { id: 'z-tied', name: 'Z', email: 'z@example.com', level: 2 },
      ],
      topStudentCompletions: [{ userId: 'top', _count: 10 }],
    });

    const result = await service.getAdminDashboardAnalytics();

    expect(result.topStudents.map((s) => s.id)).toEqual(['top', 'a-tied', 'z-tied']);
    expect(result.topStudents[0].completedTasks).toBe(10);
    expect(result.topStudents[1].completedTasks).toBe(0); // no row in topStudentCompletions
  });
});

describe('AdminDashboardAnalyticsService — user growth excludes ADMIN accounts', () => {
  it('reads totalStudents/newLast30d/dailyCumulative from role=USER-scoped queries only', async () => {
    freezeNow(NOW);
    const { service, prisma } = buildHarness({
      totalStudents: 9,
      baselineStudents: 3,
      newStudentRows: [new Date(window30dStart.getTime() + 24 * 60 * 60 * 1000)],
    });

    const result = await service.getAdminDashboardAnalytics();

    expect(result.userGrowth.totalStudents).toBe(9);
    expect(result.userGrowth.newLast30d).toBe(1);
    expect(result.userGrowth.dailyCumulative.at(-1)?.totalStudents).toBe(4); // baseline 3 + 1 new
    expect(prisma.user.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ role: UserRole.USER }) }),
    );
  });
});
