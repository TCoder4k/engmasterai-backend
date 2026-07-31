import { LessonTaskType } from '@prisma/client';
import { DashboardAnalyticsService } from './dashboard-analytics.service';

// Sprint 09 — the dashboard analytics service, against a mocked Prisma.
//
// Same technique and same reason as course-progress.service.spec.ts: the query
// count is asserted on a mock rather than via `$on('query')`, because
// PrismaService calls a bare `super()` with no query-event logging, so an
// end-to-end counter would pass by observing nothing.
//
// Every test fixes `now` explicitly. Nothing here reads the wall clock, so
// these cannot start failing at midnight or in a different CI timezone.

const VN = 'Asia/Ho_Chi_Minh'; // UTC+7
const NY = 'America/New_York'; // UTC-4 in summer

interface HarnessOptions {
  storedTimeZone?: string | null;
  stepCompletionsToday?: number;
  taskCompletionsToday?: number;
  attemptsToday?: LessonTaskType[];
  newWordsToday?: number;
  reviewsToday?: number;
  stepActivity?: Date[];
  attemptActivity?: Date[];
  reviewActivity?: Date[];
}

const buildHarness = (options: HarnessOptions = {}) => {
  const calls = { total: 0 };
  const resolve = <T>(value: T): Promise<T> => {
    calls.total += 1;
    return Promise.resolve(value);
  };

  const userUpdate = jest.fn(() => resolve({}));

  const prisma = {
    user: {
      findUniqueOrThrow: jest.fn(() =>
        resolve({ timezone: options.storedTimeZone ?? null }),
      ),
      update: userUpdate,
    },
    lessonStepProgress: {
      count: jest.fn(() => resolve(options.stepCompletionsToday ?? 0)),
      findMany: jest.fn(() =>
        resolve(
          (options.stepActivity ?? []).map((lastActivityAt) => ({
            lastActivityAt,
          })),
        ),
      ),
    },
    lessonTaskProgress: {
      count: jest.fn(() => resolve(options.taskCompletionsToday ?? 0)),
    },
    lessonTaskAttempt: {
      findMany: jest.fn(
        (args: { select?: Record<string, unknown> }): Promise<unknown> => {
          // The two lessonTaskAttempt reads are told apart by their select:
          // today's asks for the task relation, the window's for a timestamp.
          if (args?.select && 'task' in args.select) {
            return resolve(
              (options.attemptsToday ?? []).map((type) => ({ task: { type } })),
            );
          }
          return resolve(
            (options.attemptActivity ?? []).map((submittedAt) => ({
              submittedAt,
            })),
          );
        },
      ),
    },
    wordReviewLog: {
      count: jest.fn(() => resolve(options.reviewsToday ?? 0)),
      findMany: jest.fn(() =>
        resolve(
          (options.reviewActivity ?? []).map((reviewedAt) => ({ reviewedAt })),
        ),
      ),
    },
    userWordProgress: {
      count: jest.fn(() => resolve(options.newWordsToday ?? 0)),
    },
  };

  const service = new DashboardAnalyticsService(prisma as never);
  return { service, prisma, calls, userUpdate };
};

// The `where` a mocked Prisma method was called with. Typed rather than reached
// through `expect.objectContaining`, whose return type is `any` and would make
// every assertion below an unsafe assignment.
const whereOf = (fn: unknown): Record<string, unknown> =>
  (
    (fn as { mock: { calls: unknown[][] } }).mock.calls[0][0] as {
      where: Record<string, unknown>;
    }
  ).where;

// Every test pins "now" so day boundaries are deterministic.
const NOW = new Date('2026-07-31T04:00:00.000Z'); // 11:00 in VN, 00:00 in NY

const freezeNow = (instant: Date) => {
  jest.useFakeTimers({ doNotFake: ['performance'] });
  jest.setSystemTime(instant);
};

afterEach(() => {
  jest.useRealTimers();
});

describe('DashboardAnalyticsService — timezone resolution', () => {
  it('prefers the REQUEST timezone over the stored one', async () => {
    freezeNow(NOW);
    const { service } = buildHarness({ storedTimeZone: 'UTC' });

    const result = await service.getDashboardAnalytics('user-1', VN);

    expect(result.effectiveTimeZone).toBe(VN);
  });

  it('falls back to the stored timezone when the request omits one', async () => {
    freezeNow(NOW);
    const { service } = buildHarness({ storedTimeZone: VN });

    const result = await service.getDashboardAnalytics('user-1');

    expect(result.effectiveTimeZone).toBe(VN);
  });

  it('falls back to UTC when neither is available', async () => {
    freezeNow(NOW);
    const { service } = buildHarness({ storedTimeZone: null });

    const result = await service.getDashboardAnalytics('user-1');

    expect(result.effectiveTimeZone).toBe('UTC');
  });

  it('bootstraps User.timezone when the column is null', async () => {
    freezeNow(NOW);
    const { service, userUpdate } = buildHarness({ storedTimeZone: null });

    await service.getDashboardAnalytics('user-1', VN);

    expect(userUpdate).toHaveBeenCalledTimes(1);
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { timezone: VN } }),
    );
  });

  // The set-once property of the SRS quota must survive: this endpoint may seed
  // the column but must never move it afterwards.
  it('never overwrites an already-set User.timezone', async () => {
    freezeNow(NOW);
    const { service, userUpdate } = buildHarness({ storedTimeZone: 'UTC' });

    await service.getDashboardAnalytics('user-1', VN);

    expect(userUpdate).not.toHaveBeenCalled();
  });
});

describe('DashboardAnalyticsService — day boundaries', () => {
  // The bug this whole feature had to get right: 17:30Z on the 30th is already
  // 00:30 on the 31st in Vietnam.
  it('reports the LOCAL day, not the UTC day', async () => {
    freezeNow(new Date('2026-07-30T17:30:00.000Z'));
    const { service } = buildHarness();

    const result = await service.getDashboardAnalytics('user-1', VN);

    expect(result.today.date).toBe('2026-07-31');
    expect(result.activity.days.at(-1)?.date).toBe('2026-07-31');
  });

  it('reports the local day for a negative UTC offset', async () => {
    // 02:00Z on the 31st is 22:00 on the 30th in New York.
    freezeNow(new Date('2026-07-31T02:00:00.000Z'));
    const { service } = buildHarness();

    const result = await service.getDashboardAnalytics('user-1', NY);

    expect(result.today.date).toBe('2026-07-30');
  });

  it('returns exactly seven ascending days ending today', async () => {
    freezeNow(NOW);
    const { service } = buildHarness();

    const { activity } = await service.getDashboardAnalytics('user-1', VN);

    expect(activity.windowDays).toBe(7);
    expect(activity.days.map((day) => day.date)).toEqual([
      '2026-07-25',
      '2026-07-26',
      '2026-07-27',
      '2026-07-28',
      '2026-07-29',
      '2026-07-30',
      '2026-07-31',
    ]);
  });
});

describe('DashboardAnalyticsService — today counts', () => {
  it('sums step and task completions into stagesCompleted', async () => {
    freezeNow(NOW);
    const { service } = buildHarness({
      stepCompletionsToday: 2,
      taskCompletionsToday: 3,
    });

    const { today } = await service.getDashboardAnalytics('user-1', VN);

    expect(today.stagesCompleted).toBe(5);
  });

  it('splits attempts by task type', async () => {
    freezeNow(NOW);
    const { service } = buildHarness({
      attemptsToday: [
        LessonTaskType.QUIZ,
        LessonTaskType.QUIZ,
        LessonTaskType.PRACTICE,
      ],
    });

    const { today } = await service.getDashboardAnalytics('user-1', VN);

    expect(today.taskAttempts).toEqual({ quiz: 2, practice: 1, total: 3 });
  });

  it('reports vocabulary counts', async () => {
    freezeNow(NOW);
    const { service } = buildHarness({ newWordsToday: 7, reviewsToday: 42 });

    const { today } = await service.getDashboardAnalytics('user-1', VN);

    expect(today.newWordsLearned).toBe(7);
    expect(today.wordsReviewed).toBe(42);
  });

  it('reports honest zeros for a brand-new account', async () => {
    freezeNow(NOW);
    const { service } = buildHarness();

    const { today, activity } = await service.getDashboardAnalytics(
      'user-1',
      VN,
    );

    expect(today.stagesCompleted).toBe(0);
    expect(today.taskAttempts.total).toBe(0);
    expect(activity.currentStreakDays).toBe(0);
    expect(activity.days.every((day) => !day.active)).toBe(true);
  });

  // The publication filter is what keeps these counts in agreement with
  // GET /progress/courses. Asserted on the query shape because the mock cannot
  // model publication itself.
  it('filters today completion counts by lesson AND course publication', async () => {
    freezeNow(NOW);
    const { service, prisma } = buildHarness();

    await service.getDashboardAnalytics('user-1', VN);

    expect(whereOf(prisma.lessonStepProgress.count).lesson).toEqual({
      isPublished: true,
      course: { isPublished: true },
    });
    expect(whereOf(prisma.lessonTaskProgress.count).task).toEqual({
      isPublished: true,
      lesson: { isPublished: true, course: { isPublished: true } },
    });
  });

  // The other half of the deliberate asymmetry. An admin unpublishing a course
  // must not retroactively erase the fact that the student studied.
  it('does NOT filter the activity window by publication', async () => {
    freezeNow(NOW);
    const { service, prisma } = buildHarness();

    await service.getDashboardAnalytics('user-1', VN);

    expect(whereOf(prisma.lessonStepProgress.findMany)).not.toHaveProperty(
      'lesson',
    );
    expect(Object.keys(whereOf(prisma.wordReviewLog.findMany))).toEqual([
      'userId',
      'reviewedAt',
    ]);
  });
});

describe('DashboardAnalyticsService — activity calendar and streak', () => {
  // 04:00Z == 11:00 VN, so these all land on their intended local days.
  const vnDay = (day: string) => new Date(`${day}T04:00:00.000Z`);

  it('marks a day active from ANY of the three sources', async () => {
    freezeNow(NOW);
    const { service } = buildHarness({
      stepActivity: [vnDay('2026-07-29')],
      attemptActivity: [vnDay('2026-07-30')],
      reviewActivity: [vnDay('2026-07-31')],
    });

    const { activity } = await service.getDashboardAnalytics('user-1', VN);

    const active = activity.days
      .filter((day) => day.active)
      .map((day) => day.date);
    expect(active).toEqual(['2026-07-29', '2026-07-30', '2026-07-31']);
    expect(activity.currentStreakDays).toBe(3);
  });

  it('does not break the streak when today is empty but yesterday is active', async () => {
    freezeNow(NOW);
    const { service } = buildHarness({
      reviewActivity: [vnDay('2026-07-29'), vnDay('2026-07-30')],
    });

    const { activity } = await service.getDashboardAnalytics('user-1', VN);

    expect(activity.currentStreakDays).toBe(2);
    expect(activity.days.at(-1)?.active).toBe(false);
  });

  it('ignores active days sitting before a gap', async () => {
    freezeNow(NOW);
    const { service } = buildHarness({
      reviewActivity: [
        vnDay('2026-07-25'),
        vnDay('2026-07-26'),
        vnDay('2026-07-31'),
      ],
    });

    const { activity } = await service.getDashboardAnalytics('user-1', VN);

    expect(activity.currentStreakDays).toBe(1);
    expect(activity.streakCapped).toBe(false);
  });

  it('flags streakCapped when every day in the window is active', async () => {
    freezeNow(NOW);
    const { service } = buildHarness({
      reviewActivity: [
        '2026-07-25',
        '2026-07-26',
        '2026-07-27',
        '2026-07-28',
        '2026-07-29',
        '2026-07-30',
        '2026-07-31',
      ].map(vnDay),
    });

    const { activity } = await service.getDashboardAnalytics('user-1', VN);

    expect(activity.currentStreakDays).toBe(7);
    expect(activity.streakCapped).toBe(true);
  });

  it('deduplicates many activities on the same day', async () => {
    freezeNow(NOW);
    const { service } = buildHarness({
      reviewActivity: Array.from({ length: 200 }, () => vnDay('2026-07-31')),
    });

    const { activity } = await service.getDashboardAnalytics('user-1', VN);

    expect(activity.currentStreakDays).toBe(1);
    expect(activity.days.filter((day) => day.active)).toHaveLength(1);
  });

  // The window must open at the START of its first day. Fetching from
  // `now - 7 days` would clip the earliest day at 11:00 and miss this row.
  it("includes activity from early in the window's first day", async () => {
    freezeNow(NOW);
    const { service } = buildHarness({
      // 00:30 local on the first day of the window.
      reviewActivity: [new Date('2026-07-24T17:30:00.000Z')],
    });

    const { activity } = await service.getDashboardAnalytics('user-1', VN);

    expect(activity.days[0]).toEqual({ date: '2026-07-25', active: true });
  });
});

describe('DashboardAnalyticsService — query cost', () => {
  // The property is that the number does not MOVE with how much the student
  // has done, so this fails if anyone adds a per-row or per-day lookup —
  // whatever the constant happens to be that week.
  it('issues the same number of reads regardless of activity volume', async () => {
    freezeNow(NOW);

    const quiet = buildHarness({ storedTimeZone: VN });
    await quiet.service.getDashboardAnalytics('user-1');

    const busy = buildHarness({
      storedTimeZone: VN,
      stepCompletionsToday: 40,
      taskCompletionsToday: 60,
      attemptsToday: Array.from({ length: 120 }, () => LessonTaskType.QUIZ),
      newWordsToday: 300,
      reviewsToday: 900,
      stepActivity: Array.from(
        { length: 500 },
        () => new Date('2026-07-30T04:00:00.000Z'),
      ),
      reviewActivity: Array.from(
        { length: 5000 },
        () => new Date('2026-07-29T04:00:00.000Z'),
      ),
    });
    await busy.service.getDashboardAnalytics('user-1');

    expect(busy.calls.total).toBe(quiet.calls.total);
    // 1 user read + 8 analytics reads. Update this number only alongside a
    // deliberate change to the query plan documented in the service.
    expect(quiet.calls.total).toBe(9);
  });

  it('adds exactly one write when bootstrapping the timezone', async () => {
    freezeNow(NOW);
    const { service, calls } = buildHarness({ storedTimeZone: null });

    await service.getDashboardAnalytics('user-1', VN);

    expect(calls.total).toBe(10);
  });
});
