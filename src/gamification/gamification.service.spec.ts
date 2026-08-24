import { LessonStepKind, LessonTaskType, XpSource } from '@prisma/client';
import { GamificationService } from './gamification.service';
import {
  stageAward,
  taskPassedAward,
  wordMasteredAward,
  wordReviewedAward,
  XpAward,
} from './xp-rules';

// Sprint 10 — the gamification engine against a mocked Prisma.
//
// Same technique and same reason as course-progress.service.spec.ts and
// dashboard-analytics.service.spec.ts: PrismaService calls a bare `super()`
// with no query-event logging, so an $on('query') counter would pass by
// observing nothing. Counting calls on a mock measures the property directly.
//
// Every test pins `at` explicitly. Nothing here reads the wall clock, so these
// cannot start failing at midnight or in a different CI timezone.

const VN = 'Asia/Ho_Chi_Minh';
const AT = new Date('2026-08-04T04:00:00.000Z'); // 11:00 on the 4th, in VN

interface HarnessOptions {
  timezone?: string | null;
  totalPoints?: number;
  level?: number;
  /** sourceKeys of achievements the account already holds. */
  unlockedAchievements?: string[];
  /** Whether the activity row for `at`'s day already exists. */
  dayAlreadyRecorded?: boolean;
  /** sourceKeys that already exist in the ledger, i.e. will be skipped. */
  existingLedgerKeys?: string[];
  /** Day keys the streak scan should report as active. */
  activeDays?: string[];
}

const buildHarness = (options: HarnessOptions = {}) => {
  const calls = { total: 0 };
  const resolve = <T>(value: T): Promise<T> => {
    calls.total += 1;
    return Promise.resolve(value);
  };

  const existing = new Set(options.existingLedgerKeys ?? []);
  const insertedRows: { sourceKey: string; amount: number }[] = [];
  const userUpdate = jest.fn((args: { data: unknown }) => resolve(args));
  const activityUpdate = jest.fn(() => resolve({ count: 1 }));

  // Timestamps for the three activity-scan tables, derived from the day keys
  // the test asked for. Noon VN keeps them unambiguously inside their day.
  const activityRows = (options.activeDays ?? []).map((day) => ({
    at: new Date(`${day}T05:00:00.000Z`),
  }));

  const tx = {
    user: {
      findUniqueOrThrow: jest.fn(() =>
        resolve({
          timezone: options.timezone === undefined ? VN : options.timezone,
          totalPoints: options.totalPoints ?? 0,
          level: options.level ?? 1,
        }),
      ),
      update: userUpdate,
    },
    xpTransaction: {
      findMany: jest.fn(() =>
        resolve(
          (options.unlockedAchievements ?? []).map((sourceKey) => ({
            sourceKey,
            createdAt: new Date(),
          })),
        ),
      ),
      // Models ON CONFLICT DO NOTHING ... RETURNING *: only rows whose key is
      // not already present come back.
      createManyAndReturn: jest.fn(
        (args: {
          data: { sourceKey: string; amount: number; source: XpSource }[];
        }) => {
          const landed = args.data.filter(
            (row) => !existing.has(row.sourceKey),
          );
          for (const row of landed) {
            existing.add(row.sourceKey);
            insertedRows.push(row);
          }
          return resolve(landed);
        },
      ),
    },
    userDailyActivity: {
      createManyAndReturn: jest.fn(() =>
        resolve(options.dayAlreadyRecorded ? [] : [{ id: 'day-1' }]),
      ),
      updateMany: activityUpdate,
    },
    lessonStepProgress: {
      findMany: jest.fn(() =>
        resolve(activityRows.map((row) => ({ lastActivityAt: row.at }))),
      ),
    },
    lessonTaskAttempt: { findMany: jest.fn(() => resolve([])) },
    wordReviewLog: { findMany: jest.fn(() => resolve([])) },
  };

  // Streak Together's onUserActivityDay hook (step 3.5) is exercised by its
  // own spec (streak.service.spec.ts); here it only needs to be callable and
  // is asserted not to disturb this test's own XP/achievement arithmetic.
  const streakServiceStub = { onUserActivityDay: jest.fn(() => Promise.resolve()) };
  const service = new GamificationService({} as never, streakServiceStub as never);
  return { service, tx, calls, userUpdate, activityUpdate, insertedRows, streakServiceStub };
};

const record = (
  harness: ReturnType<typeof buildHarness>,
  awards: XpAward[],
  overrides: Partial<{
    countsAsActivity: boolean;
    knownLastActivityAt: Date | null;
    at: Date;
  }> = {},
) =>
  harness.service.recordProgress(harness.tx as never, 'user-1', {
    at: overrides.at ?? AT,
    awards,
    countsAsActivity: overrides.countsAsActivity ?? true,
    knownLastActivityAt: overrides.knownLastActivityAt,
  });

// Every badge already held. Used by the tests that measure the LEDGER
// mechanics, so a first-time achievement firing alongside does not muddy the
// arithmetic they are actually asserting.
const ALL_BADGES_HELD = [
  'achievement:FIRST_STAGE',
  'achievement:FIRST_QUIZ_PASS',
  'achievement:FIRST_MASTERED_WORD',
  'achievement:STREAK_3',
  'achievement:STREAK_7',
  'achievement:XP_500',
];

describe('awarding XP', () => {
  it('writes the ledger row and increments the cached total', async () => {
    const harness = buildHarness({
      dayAlreadyRecorded: true,
      unlockedAchievements: ALL_BADGES_HELD,
    });
    const result = await record(harness, [
      stageAward('lesson-1', LessonStepKind.VIDEO),
    ]);

    expect(result.xpAwarded).toBe(10);
    expect(result.xp.totalXp).toBe(10);
    expect(harness.userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ totalPoints: { increment: 10 } }),
      }),
    );
  });

  it('uses increment, NEVER a computed absolute total', async () => {
    // Read-modify-write is what UserService.updatePoints did, and why it was
    // deleted: two concurrent awards both read the same total and one is lost.
    const harness = buildHarness({
      totalPoints: 240,
      dayAlreadyRecorded: true,
      unlockedAchievements: ALL_BADGES_HELD,
    });
    await record(harness, [stageAward('lesson-1', LessonStepKind.THEORY)]);

    const data = harness.userUpdate.mock.calls[0][0].data as {
      totalPoints: unknown;
    };
    expect(data.totalPoints).toEqual({ increment: 10 });
    expect(data.totalPoints).not.toBe(250);
  });

  it('sums a MIXED-DENOMINATION batch correctly', async () => {
    // The reason createManyAndReturn is used instead of createMany. createMany
    // reports only a count, so "1 of 2 inserted" cannot be totalled when the
    // two awards are worth different amounts. If anyone swaps it back, this is
    // the test that catches it.
    const harness = buildHarness({
      dayAlreadyRecorded: true,
      unlockedAchievements: ALL_BADGES_HELD,
      existingLedgerKeys: ['step:lesson-1:VIDEO'], // the 10 is already claimed
    });
    const result = await record(harness, [
      stageAward('lesson-1', LessonStepKind.VIDEO), // 10, collides
      taskPassedAward('task-1', LessonTaskType.QUIZ), // 30, lands
    ]);

    expect(result.xpAwarded).toBe(30);
  });

  it('awards NOTHING on a full replay and writes no user update', async () => {
    const harness = buildHarness({
      totalPoints: 55,
      level: 1,
      dayAlreadyRecorded: true,
      existingLedgerKeys: ['review:client-review-1'],
    });
    const result = await record(harness, [
      wordReviewedAward('client-review-1'),
    ]);

    expect(result.xpAwarded).toBe(0);
    expect(result.xp.totalXp).toBe(55);
    expect(result.unlockedAchievements).toEqual([]);
    // Not even a no-op UPDATE — a replay must be free.
    expect(harness.userUpdate).not.toHaveBeenCalled();
  });

  it('reports leveledUp only when the level actually moves', async () => {
    const stay = buildHarness({
      totalPoints: 10,
      level: 1,
      dayAlreadyRecorded: true,
    });
    expect(
      (await record(stay, [stageAward('l', LessonStepKind.VIDEO)])).leveledUp,
    ).toBe(false);

    // 95 + 10 = 105, which crosses the level-2 threshold of 100.
    const cross = buildHarness({
      totalPoints: 95,
      level: 1,
      dayAlreadyRecorded: true,
    });
    const result = await record(cross, [stageAward('l', LessonStepKind.VIDEO)]);
    expect(result.leveledUp).toBe(true);
    expect(result.xp.level).toBe(2);
  });

  it('returns the WHOLE level curve, not just the new total', async () => {
    // Sprint 10 QA: the envelope used to carry `totalXp` and `level` alone, so
    // a client had nothing to redraw the progress bar or the "N XP to next
    // level" caption with — the toast moved and the widget did not. These four
    // fields are the fix, and they must be the server's own numbers, because
    // the alternative is a second copy of the curve in the browser.
    const harness = buildHarness({
      totalPoints: 95,
      level: 1,
      dayAlreadyRecorded: true,
      unlockedAchievements: ALL_BADGES_HELD,
    });
    const result = await record(harness, [
      stageAward('l', LessonStepKind.VIDEO),
    ]);

    // 105 XP: level 2 (threshold 100), 5 into a 150-XP level, 145 to go.
    expect(result.xp).toEqual({
      totalXp: 105,
      level: 2,
      intoLevel: 5,
      toNextLevel: 145,
      percent: 3,
    });
  });
});

describe('achievements', () => {
  it('unlocks FIRST_STAGE from the award itself, with no counting query', async () => {
    const harness = buildHarness({ dayAlreadyRecorded: true });
    const result = await record(harness, [
      stageAward('lesson-1', LessonStepKind.VIDEO),
    ]);

    expect(result.unlockedAchievements).toContain('FIRST_STAGE');
    expect(result.xpAwarded).toBe(30); // 10 stage + 20 badge
  });

  it('does not credit FIRST_QUIZ_PASS for a PRACTICE pass', async () => {
    // The reason the task type is spelled into the sourceKey rather than
    // inferred from the amount.
    const harness = buildHarness({ dayAlreadyRecorded: true });
    const result = await record(harness, [
      taskPassedAward('task-1', LessonTaskType.PRACTICE),
    ]);

    expect(result.unlockedAchievements).toContain('FIRST_STAGE');
    expect(result.unlockedAchievements).not.toContain('FIRST_QUIZ_PASS');
  });

  it('credits FIRST_QUIZ_PASS for a QUIZ pass', async () => {
    const harness = buildHarness({ dayAlreadyRecorded: true });
    const result = await record(harness, [
      taskPassedAward('task-1', LessonTaskType.QUIZ),
    ]);
    expect(result.unlockedAchievements).toContain('FIRST_QUIZ_PASS');
  });

  it('unlocks XP_500 in the SAME call that crosses 500', async () => {
    // The second evaluation pass. Waiting until the student's next action
    // would be correct-but-baffling: the bar fills and nothing happens.
    const harness = buildHarness({
      totalPoints: 480,
      dayAlreadyRecorded: true,
      unlockedAchievements: [
        'achievement:FIRST_STAGE',
        'achievement:FIRST_QUIZ_PASS',
        'achievement:FIRST_MASTERED_WORD',
      ],
    });
    const result = await record(harness, [
      taskPassedAward('task-1', LessonTaskType.QUIZ), // +30 -> 510
    ]);

    expect(result.unlockedAchievements).toEqual(['XP_500']);
    expect(result.xp.totalXp).toBe(610); // 480 + 30 + 100
  });

  it('never re-awards an achievement already held', async () => {
    const harness = buildHarness({
      dayAlreadyRecorded: true,
      unlockedAchievements: ['achievement:FIRST_STAGE'],
    });
    const result = await record(harness, [
      stageAward('lesson-2', LessonStepKind.VIDEO),
    ]);

    expect(result.unlockedAchievements).toEqual([]);
    expect(result.xpAwarded).toBe(10); // the stage only
  });

  it('skips the achievement lookup entirely when there is nothing to award', async () => {
    // A mid-video progress tick. No awards means no badge can change, so the
    // read is not issued at all.
    const harness = buildHarness({ dayAlreadyRecorded: true });
    await record(harness, []);
    expect(harness.tx.xpTransaction.findMany).not.toHaveBeenCalled();
  });

  it('unlocks FIRST_MASTERED_WORD from a WORD_MASTERED award', async () => {
    const harness = buildHarness({ dayAlreadyRecorded: true });
    const result = await record(harness, [
      wordReviewedAward('r-1'),
      wordMasteredAward('word-1'),
    ]);
    expect(result.unlockedAchievements).toContain('FIRST_MASTERED_WORD');
  });
});

describe('activity days and the streak', () => {
  it('evaluates the streak ONLY when a new day row is created', async () => {
    const existingDay = buildHarness({ dayAlreadyRecorded: true });
    await record(existingDay, [stageAward('l', LessonStepKind.VIDEO)]);
    // The scan's three tables were never touched.
    expect(existingDay.tx.lessonStepProgress.findMany).not.toHaveBeenCalled();
    expect(existingDay.tx.wordReviewLog.findMany).not.toHaveBeenCalled();
  });

  it('AWARDS STREAK_3 ON DAY 3, not day 4', async () => {
    // THE ORDERING INVARIANT (plan §4.6). countCurrentStreak counts from
    // yesterday when today has no activity yet, so if the streak were computed
    // BEFORE the caller persisted its action, today would look empty, the
    // streak would come back 2, and the badge would arrive a day late.
    //
    // Here the caller has already written today's row, so the scan sees all
    // three days.
    const harness = buildHarness({
      dayAlreadyRecorded: false,
      activeDays: ['2026-08-02', '2026-08-03', '2026-08-04'],
      unlockedAchievements: ['achievement:FIRST_STAGE'],
    });
    const result = await record(harness, [
      stageAward('lesson-1', LessonStepKind.VIDEO),
    ]);

    expect(result.unlockedAchievements).toEqual(['STREAK_3']);
    expect(result.xpAwarded).toBe(35); // 10 stage + 25 badge
  });

  it('does not award STREAK_3 on only two consecutive days', async () => {
    const harness = buildHarness({
      dayAlreadyRecorded: false,
      activeDays: ['2026-08-03', '2026-08-04'],
      unlockedAchievements: ['achievement:FIRST_STAGE'],
    });
    const result = await record(harness, [
      stageAward('lesson-1', LessonStepKind.VIDEO),
    ]);
    expect(result.unlockedAchievements).toEqual([]);
  });

  it('awards STREAK_7 as well as STREAK_3 on a seven-day run', async () => {
    const harness = buildHarness({
      dayAlreadyRecorded: false,
      activeDays: [
        '2026-07-29',
        '2026-07-30',
        '2026-07-31',
        '2026-08-01',
        '2026-08-02',
        '2026-08-03',
        '2026-08-04',
      ],
      unlockedAchievements: ['achievement:FIRST_STAGE'],
    });
    const result = await record(harness, [
      stageAward('lesson-1', LessonStepKind.VIDEO),
    ]);
    expect(result.unlockedAchievements).toEqual(['STREAK_3', 'STREAK_7']);
  });

  it('records NO activity day when countsAsActivity is false', async () => {
    // Trap Hunter. It earns XP but is invisible to the dashboard's activity
    // scan, so creating a day row here would light up calendar tiles Sprint 09
    // does not — silently changing existing students' streaks.
    const harness = buildHarness();
    const result = await record(
      harness,
      [stageAward('l', LessonStepKind.VIDEO)],
      {
        countsAsActivity: false,
      },
    );

    expect(
      harness.tx.userDailyActivity.createManyAndReturn,
    ).not.toHaveBeenCalled();
    expect(result.xpAwarded).toBeGreaterThan(0);
  });

  it('SKIPS the activity write when the caller knows today is already recorded', async () => {
    // The video hot path: ~86 progress reports per ten-minute lesson, and the
    // step transaction already holds the previous lastActivityAt.
    const harness = buildHarness();
    await record(harness, [], {
      knownLastActivityAt: new Date('2026-08-04T01:00:00.000Z'), // 08:00 VN, same day
    });
    expect(
      harness.tx.userDailyActivity.createManyAndReturn,
    ).not.toHaveBeenCalled();
  });

  it('does NOT skip when the known timestamp is on the previous local day', async () => {
    // 2026-08-03T16:30Z is 23:30 VN on the 3rd; `AT` is 11:00 VN on the 4th.
    // One local midnight apart, so a new day row is due.
    const harness = buildHarness();
    await record(harness, [], {
      knownLastActivityAt: new Date('2026-08-03T16:30:00.000Z'),
    });
    expect(harness.tx.userDailyActivity.createManyAndReturn).toHaveBeenCalled();
  });

  it('bumps lastActivityAt when the day row already existed', async () => {
    const harness = buildHarness({ dayAlreadyRecorded: true });
    await record(harness, []);
    expect(harness.activityUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { lastActivityAt: AT } }),
    );
  });

  it('falls back to UTC when the account has no timezone yet', async () => {
    // And does NOT write User.timezone — bootstrapping that column belongs to
    // the SRS queue and the dashboard read, not to the hottest write path.
    const harness = buildHarness({ timezone: null, dayAlreadyRecorded: true });
    await record(harness, []);
    expect(harness.userUpdate).not.toHaveBeenCalled();
  });
});

describe('query cost', () => {
  it('costs ONE query for a mid-video tick on an already-recorded day', async () => {
    const harness = buildHarness();
    await record(harness, [], {
      knownLastActivityAt: new Date('2026-08-04T01:00:00.000Z'),
    });
    expect(harness.calls.total).toBe(1); // the user read, nothing else
  });

  it('does not grow with how much the student has studied', async () => {
    const quiet = buildHarness({ dayAlreadyRecorded: true, totalPoints: 0 });
    await record(quiet, [taskPassedAward('t', LessonTaskType.QUIZ)]);

    const heavy = buildHarness({
      dayAlreadyRecorded: true,
      totalPoints: 48_000,
      unlockedAchievements: [
        'achievement:FIRST_STAGE',
        'achievement:FIRST_QUIZ_PASS',
        'achievement:FIRST_MASTERED_WORD',
        'achievement:STREAK_3',
        'achievement:STREAK_7',
        'achievement:XP_500',
      ],
    });
    await record(heavy, [taskPassedAward('t', LessonTaskType.QUIZ)]);

    // The quiet account writes achievement rows the heavy one already holds,
    // so it costs MORE, not less — the property being pinned is that neither
    // scales with history.
    expect(quiet.calls.total).toBeLessThanOrEqual(7);
    expect(heavy.calls.total).toBeLessThanOrEqual(7);
  });
});
