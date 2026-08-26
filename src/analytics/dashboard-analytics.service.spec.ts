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
  dictationActivity?: Date[];
  shadowingActivity?: Date[];
  studySecondsToday?: number | null;
  recentAccuracyAttempts?: number[];
  topStudentGroups?: { userId: string; _sum: { creditedSeconds: number | null } }[];
  topStudentUsers?: { id: string; name: string; email: string; level: number }[];
  topStudentCompletions?: { userId: string; _count: number }[];
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
      findMany: jest.fn(() => resolve(options.topStudentUsers ?? [])),
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
      groupBy: jest.fn(() => resolve(options.topStudentCompletions ?? [])),
    },
    lessonTaskAttempt: {
      findMany: jest.fn(
        (args: { select?: Record<string, unknown> }): Promise<unknown> => {
          // The three lessonTaskAttempt reads are told apart by their select:
          // today's asks for the task relation, the window's for a timestamp,
          // recent-accuracy's for accuracyPercent.
          if (args?.select && 'task' in args.select) {
            return resolve(
              (options.attemptsToday ?? []).map((type) => ({ task: { type } })),
            );
          }
          if (args?.select && 'accuracyPercent' in args.select) {
            return resolve(
              (options.recentAccuracyAttempts ?? []).map((accuracyPercent) => ({
                accuracyPercent,
              })),
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
    listeningDictationAttempt: {
      findMany: jest.fn(() =>
        resolve(
          (options.dictationActivity ?? []).map((submittedAt) => ({ submittedAt })),
        ),
      ),
    },
    listeningShadowingAttempt: {
      findMany: jest.fn(() =>
        resolve(
          (options.shadowingActivity ?? []).map((submittedAt) => ({ submittedAt })),
        ),
      ),
    },
    userWordProgress: {
      count: jest.fn(() => resolve(options.newWordsToday ?? 0)),
    },
    studyTimeEvent: {
      // `null` is what Postgres actually returns for SUM over an empty set, so
      // the default models an account with no heartbeats rather than one with
      // a convenient zero.
      aggregate: jest.fn(() =>
        resolve({
          _sum: { creditedSeconds: options.studySecondsToday ?? null },
        }),
      ),
      groupBy: jest.fn(() => resolve(options.topStudentGroups ?? [])),
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
    const todayTile = result.activity.days.find((day) => day.date === '2026-07-31');
    expect(todayTile).toBeDefined();
    expect(todayTile?.isFuture).toBe(false);
  });

  it('reports the local day for a negative UTC offset', async () => {
    // 02:00Z on the 31st is 22:00 on the 30th in New York.
    freezeNow(new Date('2026-07-31T02:00:00.000Z'));
    const { service } = buildHarness();

    const result = await service.getDashboardAnalytics('user-1', NY);

    expect(result.today.date).toBe('2026-07-30');
  });

  // NOW is Friday 2026-07-31 in VN, so the fixed Monday-Sunday week
  // containing it is 07-27..08-02 — a DIFFERENT 7 days than the rolling
  // window countCurrentStreak uses (07-25..07-31, see the next describe
  // block), and deliberately so: this array is what the widget DISPLAYS.
  it('returns exactly seven ascending days for the calendar week containing today, Monday first', async () => {
    freezeNow(NOW);
    const { service } = buildHarness();

    const { activity } = await service.getDashboardAnalytics('user-1', VN);

    expect(activity.windowDays).toBe(7);
    expect(activity.days.map((day) => day.date)).toEqual([
      '2026-07-27',
      '2026-07-28',
      '2026-07-29',
      '2026-07-30',
      '2026-07-31',
      '2026-08-01',
      '2026-08-02',
    ]);
  });

  it('marks only the days AFTER today as future, never today itself', async () => {
    freezeNow(NOW);
    const { service } = buildHarness();

    const { activity } = await service.getDashboardAnalytics('user-1', VN);

    expect(activity.days.map((day) => day.isFuture)).toEqual([
      false, // 07-27 Mon
      false, // 07-28 Tue
      false, // 07-29 Wed
      false, // 07-30 Thu
      false, // 07-31 Fri — today
      true, // 08-01 Sat
      true, // 08-02 Sun
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
    const todayTile = activity.days.find((day) => day.date === '2026-07-31');
    expect(todayTile?.active).toBe(false);
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

  // The (streak-counting) window must open at the START of its first day.
  // Fetching from `now - 7 days` would clip the earliest day at 11:00 and
  // miss this row. Asserted directly on the query boundary rather than
  // through `activity.days` — 07-25 is the rolling window's first day, but
  // it is NOT part of the calendar week displayed for this NOW (07-27..08-02,
  // see the block above), so it no longer appears in that array at all.
  it('opens the underlying query at the START of the window, not clipped to "now"', async () => {
    freezeNow(NOW);
    const { service, prisma } = buildHarness({
      // 00:30 local on the first day of the window.
      reviewActivity: [new Date('2026-07-24T17:30:00.000Z')],
    });

    await service.getDashboardAnalytics('user-1', VN);

    expect(whereOf(prisma.wordReviewLog.findMany).reviewedAt).toEqual({
      gte: new Date('2026-07-24T17:00:00.000Z'), // 2026-07-25 00:00 VN
    });
  });

  it('still counts that early-in-the-day activity toward the streak', async () => {
    freezeNow(NOW);
    const { service } = buildHarness({
      // 00:30 local on the first day of the window, then every day after.
      reviewActivity: [
        new Date('2026-07-24T17:30:00.000Z'), // 07-25 00:30 VN
        ...['2026-07-26', '2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31'].map(
          (day) => new Date(`${day}T04:00:00.000Z`),
        ),
      ],
    });

    const { activity } = await service.getDashboardAnalytics('user-1', VN);

    expect(activity.currentStreakDays).toBe(7);
    expect(activity.streakCapped).toBe(true);
  });

  // The Streak Together listening extension: a day with ONLY a dictation or
  // shadowing attempt — no lesson step, no quiz, no SRS review — must still
  // light up the individual streak calendar, since collectActiveDays now
  // treats it as a qualifying activity day (see activity-window.ts).
  it('counts a dictation-only day as active', async () => {
    freezeNow(NOW);
    const { service } = buildHarness({ dictationActivity: [NOW] });

    const { activity } = await service.getDashboardAnalytics('user-1', VN);

    const todayTile = activity.days.find((day) => day.date === '2026-07-31');
    expect(todayTile).toEqual({ date: '2026-07-31', active: true, isFuture: false });
  });

  it('counts a shadowing-only day as active', async () => {
    freezeNow(NOW);
    const { service } = buildHarness({ shadowingActivity: [NOW] });

    const { activity } = await service.getDashboardAnalytics('user-1', VN);

    const todayTile = activity.days.find((day) => day.date === '2026-07-31');
    expect(todayTile).toEqual({ date: '2026-07-31', active: true, isFuture: false });
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
      studySecondsToday: 5_400,
    });
    await busy.service.getDashboardAnalytics('user-1');

    expect(busy.calls.total).toBe(quiet.calls.total);
    // 1 user read + 12 analytics reads. Update this number only alongside a
    // deliberate change to the query plan documented in the service.
    // Sprint 10.5 raised it from 9 to 10 by adding the study-seconds SUM;
    // a later change raised it from 10 to 11 by adding the recent-accuracy
    // read; the Streak Together listening extension raised it from 11 to 13
    // by adding the ListeningDictationAttempt and ListeningShadowingAttempt
    // reads inside collectActiveDays (activity-window.ts).
    expect(quiet.calls.total).toBe(13);
  });

  it('adds exactly one write when bootstrapping the timezone', async () => {
    freezeNow(NOW);
    const { service, calls } = buildHarness({ storedTimeZone: null });

    await service.getDashboardAnalytics('user-1', VN);

    expect(calls.total).toBe(14);
  });
});

// Sprint 10.5 — the Daily Goal widget's numerator.
describe('DashboardAnalyticsService — active study seconds', () => {
  it('reports the summed study seconds for today', async () => {
    freezeNow(NOW);
    const { service } = buildHarness({
      storedTimeZone: VN,
      studySecondsToday: 1_080,
    });

    const { today } = await service.getDashboardAnalytics('user-1');

    expect(today.activeStudySeconds).toBe(1_080);
  });

  it('reports 0 — not null — for an account with no heartbeats', async () => {
    // Postgres SUM over an empty set is NULL. Letting that reach the DTO would
    // render "null phút" on the widget, and `null` is the client's ERROR state.
    freezeNow(NOW);
    const { service } = buildHarness({
      storedTimeZone: VN,
      studySecondsToday: null,
    });

    const { today } = await service.getDashboardAnalytics('user-1');

    expect(today.activeStudySeconds).toBe(0);
  });

  it('sums from the start of the day in the EFFECTIVE timezone', async () => {
    freezeNow(NOW); // 11:00 in VN, 00:00 in NY
    const { service, prisma } = buildHarness({ storedTimeZone: VN });

    await service.getDashboardAnalytics('user-1', NY);

    const where = whereOf(prisma.studyTimeEvent.aggregate);
    expect(where.occurredAt).toEqual({
      gte: new Date('2026-07-31T04:00:00.000Z'),
    });
  });
});

describe('DashboardAnalyticsService — recent accuracy', () => {
  it('averages accuracyPercent across the recent attempts', async () => {
    freezeNow(NOW);
    const { service } = buildHarness({
      recentAccuracyAttempts: [100, 50, 75],
    });

    const { recentAccuracyPercent } = await service.getDashboardAnalytics(
      'user-1',
      VN,
    );

    expect(recentAccuracyPercent).toBe(75);
  });

  it('rounds to the nearest whole percent', async () => {
    freezeNow(NOW);
    const { service } = buildHarness({
      recentAccuracyAttempts: [100, 100, 0],
    });

    const { recentAccuracyPercent } = await service.getDashboardAnalytics(
      'user-1',
      VN,
    );

    expect(recentAccuracyPercent).toBe(67);
  });

  // null, not 0 — a student who has never taken a graded attempt has not
  // "scored 0%", they have no score at all. Same discipline as
  // activeStudySeconds' own 0-vs-null distinction, just the other value.
  it('reports null — not 0 — for a student with no graded attempts', async () => {
    freezeNow(NOW);
    const { service } = buildHarness({ recentAccuracyAttempts: [] });

    const { recentAccuracyPercent } = await service.getDashboardAnalytics(
      'user-1',
      VN,
    );

    expect(recentAccuracyPercent).toBeNull();
  });

  it('only reads attempts on published tasks', async () => {
    freezeNow(NOW);
    const { service, prisma } = buildHarness();

    await service.getDashboardAnalytics('user-1', VN);

    const accuracyCall = prisma.lessonTaskAttempt.findMany.mock.calls.find(
      (call) => call[0]?.select && 'accuracyPercent' in call[0].select,
    )?.[0] as unknown as {
      where: { task: Record<string, unknown> };
      take: number;
      orderBy: Record<string, unknown>;
    };
    expect(accuracyCall.where.task).toEqual({
      isPublished: true,
      lesson: { isPublished: true, course: { isPublished: true } },
    });
    expect(accuracyCall.take).toBe(20);
    expect(accuracyCall.orderBy).toEqual({ submittedAt: 'desc' });
  });
});

// GET /analytics/top-students — the student-facing sibling of
// AdminDashboardAnalyticsService's own topStudents ranking (see that
// service's spec for the shared ranking/tie-break behavior itself, exercised
// there against the same rankTopStudents helper this method calls). These
// tests cover only what's specific to this method: the empty case and,
// critically, that `email` never survives into the returned rows.
describe('DashboardAnalyticsService — getTopStudents', () => {
  it('returns an empty list rather than throwing when no StudyTimeEvent rows exist', async () => {
    const { service } = buildHarness({});

    const result = await service.getTopStudents();

    expect(result).toEqual([]);
  });

  it('ranks by total study seconds and maps completedTasks per student', async () => {
    const { service } = buildHarness({
      topStudentGroups: [
        { userId: 'top', _sum: { creditedSeconds: 6000 } },
        { userId: 'runner-up', _sum: { creditedSeconds: 3000 } },
      ],
      topStudentUsers: [
        { id: 'top', name: 'Top Student', email: 'top@example.com', level: 6 },
        { id: 'runner-up', name: 'Runner Up', email: 'runner-up@example.com', level: 2 },
      ],
      topStudentCompletions: [{ userId: 'top', _count: 10 }],
    });

    const result = await service.getTopStudents();

    expect(result.map((s) => s.id)).toEqual(['top', 'runner-up']);
    expect(result[0]).toMatchObject({
      name: 'Top Student',
      level: 6,
      totalStudySeconds: 6000,
      completedTasks: 10,
    });
    // No row in topStudentCompletions for 'runner-up' — must default to 0,
    // not be dropped or left undefined.
    expect(result[1].completedTasks).toBe(0);
  });

  it('never includes an email field — the entire point of this method existing separately from the admin one', async () => {
    const { service } = buildHarness({
      topStudentGroups: [{ userId: 'top', _sum: { creditedSeconds: 100 } }],
      topStudentUsers: [{ id: 'top', name: 'Top Student', email: 'top@example.com', level: 1 }],
      topStudentCompletions: [],
    });

    const result = await service.getTopStudents();

    expect(result[0]).not.toHaveProperty('email');
    expect(JSON.stringify(result)).not.toContain('top@example.com');
  });
});
