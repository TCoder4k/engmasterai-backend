import { Injectable } from '@nestjs/common';
import { Prisma, XpSource } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  countCurrentStreak,
  enumerateDaysInTimeZone,
} from '../analytics/day-window';
import { collectActiveDays } from '../shared/activity-window';
import { publishedLesson, publishedTask } from '../shared/published-scope';
import { startOfDayInTimeZone } from '../learning/timezone.util';
import {
  AchievementKey,
  AchievementSnapshot,
  evaluateAchievements,
  newlyEarnedAchievements,
} from './achievement-catalog';
import { activityDayFor, isSameActivityDay } from './day-key';
import {
  GamificationProfileDto,
  GamificationResultDto,
  noAward,
  RecordProgressInput,
} from './gamification.types';
import { achievementAward, isQuizPassKey, XpAward } from './xp-rules';
import { levelProgress } from './level-curve';

// How far back the streak scan looks when deciding whether a milestone was
// reached. Sprint 10's badges stop at 7 days, so 10 is comfortably enough to
// see a 7-day run plus the gap that would break it. Not a display window —
// nothing renders this number.
const STREAK_SCAN_DAYS = 10;

// The streak lengths that carry a badge, ascending. Derived from the catalog's
// own keys rather than restated, so adding STREAK_14 cannot leave this behind.
const STREAK_MILESTONES = [3, 7] as const;

/**
 * Sprint 10 — the gamification engine.
 *
 * EVERY WRITE METHOD TAKES THE CALLER'S TRANSACTION. Nothing here opens one.
 * The XP for finishing a stage must land in the same transaction that recorded
 * the stage, or the two can disagree; a student whose progress saved but whose
 * XP did not has a discrepancy nobody can detect afterwards. The accepted
 * consequence is stated plainly: if the ledger write fails for a reason other
 * than a duplicate, the learning action rolls back with it. Progress and XP
 * succeed or fail together.
 *
 * THERE IS NO try/catch AROUND THE LEDGER INSERT, and there must not be. A
 * failed statement aborts the entire Postgres transaction and Prisma exposes
 * no savepoint, so a catch could not recover — it could only turn a rollback
 * into a 500. QuizService.submitTask documents this the long way, having been
 * bitten by it. The insert is made CONFLICT-FREE instead
 * (skipDuplicates -> ON CONFLICT DO NOTHING), so the expected collision is not
 * an error at all.
 *
 * THE ORDER OF OPERATIONS IS LOAD-BEARING (plan §4.6):
 *
 *   1. the caller persists the learning action        (before calling in)
 *   2. record the activity day
 *   3. compute the streak — ONLY if step 2 created a NEW day row
 *   4. award the action's XP, then any newly earned achievements
 *
 * Step 1 must precede step 3. countCurrentStreak's rule is "if today has no
 * activity yet, count from yesterday" (day-window.ts), and the streak scan
 * reads the very tables step 1 writes. Run the scan first and today looks
 * empty, the streak comes back one short, and the 3-day badge arrives on day
 * four — for a student who did exactly what was asked. The scan sees step 1's
 * writes because both are inside the same transaction.
 */
@Injectable()
export class GamificationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The single entry point for every learning engine.
   *
   * QUERY COST, worst case, on the first action of a new day:
   *   1  user (timezone + totals)  ─┐ together
   *   1  unlocked achievement keys ─┘
   *   1  activity day insert (2 when the day already existed)
   *   3  streak scan               (new day only)
   *   1  award insert  +  1 total increment  +  1 level update (when it moves)
   *   1  achievement insert + 1 increment    (only when something unlocked)
   *
   * STEADY STATE IS MUCH SMALLER. A mid-video progress tick with nothing to
   * award and today's activity already recorded costs ONE query — the user
   * read — and returns. That path runs ~86 times per ten-minute lesson, which
   * is why it is the one that got optimised.
   */
  async recordProgress(
    tx: Prisma.TransactionClient,
    userId: string,
    input: RecordProgressInput,
  ): Promise<GamificationResultDto> {
    const needsAchievementCheck = input.awards.length > 0;

    const [user, unlockedKeys] = await Promise.all([
      tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { timezone: true, totalPoints: true, level: true },
      }),
      // At most six rows, on [userId, source]. Read up-front so the achievement
      // candidates below are EXACT: once a student holds all six, no insert is
      // attempted at all rather than one being attempted and discarded on every
      // single action for the rest of the account's life.
      needsAchievementCheck
        ? tx.xpTransaction.findMany({
            where: { userId, source: XpSource.ACHIEVEMENT },
            select: { sourceKey: true },
          })
        : // Typed rather than a bare `[]`, which would widen the whole
          // destructured tuple to `any` and silently un-type every use below.
          Promise.resolve<{ sourceKey: string }[]>([]),
    ]);

    // UTC when the column is still null. Deliberately NOT bootstrapped here:
    // writing User.timezone is owned by LearningService.getDueReviews (which
    // spends the SRS quota) and DashboardAnalyticsService, and adding a third
    // writer on the hottest write path in the app would make "who set this"
    // unanswerable. A UTC-bucketed day is recorded honestly in `timeZone`.
    const timeZone = user.timezone ?? 'UTC';

    // --- 2. the activity day -------------------------------------------------
    const isNewDay = input.countsAsActivity
      ? await this.recordActivityDay(tx, userId, input, timeZone)
      : false;

    // --- 3. the streak, only when a new day just began -----------------------
    const streakDays = isNewDay
      ? await this.currentStreak(tx, userId, input.at, timeZone)
      : null;

    // --- 4. the awards -------------------------------------------------------
    return this.award(tx, userId, {
      actionAwards: input.awards,
      previousTotal: user.totalPoints,
      previousLevel: user.level,
      streakDays,
      // Bare catalog keys, not raw sourceKeys: newlyEarnedAchievements matches
      // on `FIRST_STAGE`, while the ledger stores `achievement:FIRST_STAGE`.
      // Passing the prefixed form through would make every already-held badge
      // look unheld and re-attempt an insert on every single action.
      unlockedKeys: new Set(
        unlockedKeys.map((row) => keyFromAchievementSourceKey(row.sourceKey)),
      ),
    });
  }

  /**
   * Upsert today's activity row. Returns whether it was CREATED.
   *
   * createManyAndReturn + skipDuplicates rather than upsert(), because upsert
   * cannot tell the caller which branch it took — and "was this the first
   * activity of a new day" is precisely the question, since it is the trigger
   * for evaluating the streak.
   */
  private async recordActivityDay(
    tx: Prisma.TransactionClient,
    userId: string,
    input: RecordProgressInput,
    timeZone: string,
  ): Promise<boolean> {
    // The hot-path skip. If the caller's own previous timestamp is already on
    // today's date, the row exists and there is nothing to decide.
    if (
      input.knownLastActivityAt &&
      isSameActivityDay(input.knownLastActivityAt, input.at, timeZone)
    ) {
      return false;
    }

    const day = activityDayFor(input.at, timeZone);
    const created = await tx.userDailyActivity.createManyAndReturn({
      data: [
        {
          userId,
          day,
          timeZone,
          firstActivityAt: input.at,
          lastActivityAt: input.at,
        },
      ],
      skipDuplicates: true,
    });

    if (created.length > 0) return true;

    // The day already existed. Keep lastActivityAt moving; firstActivityAt is
    // never touched again.
    await tx.userDailyActivity.updateMany({
      where: { userId, day },
      data: { lastActivityAt: input.at },
    });
    return false;
  }

  /**
   * The student's current streak, from the same three tables the dashboard
   * reads (shared/activity-window.ts) and the same counting rule
   * (countCurrentStreak).
   *
   * Runs at most ONCE PER STUDENT PER DAY — only on the action that opened a
   * new activity day. That is what keeps three extra reads off every review
   * submission.
   */
  private async currentStreak(
    tx: Prisma.TransactionClient,
    userId: string,
    at: Date,
    timeZone: string,
  ): Promise<number> {
    const days = enumerateDaysInTimeZone(at, timeZone, STREAK_SCAN_DAYS);
    // Open the window at the START of its first day. Subtracting a duration
    // would clip that day at whatever time it happens to be now, so the
    // earliest day would only count activity later than this morning.
    const windowStart = startOfDayInTimeZone(
      new Date(`${days[0]}T12:00:00.000Z`),
      timeZone,
    );
    const activeDays = await collectActiveDays(
      tx,
      userId,
      windowStart,
      timeZone,
    );
    return countCurrentStreak(days, activeDays);
  }

  /**
   * Write the ledger rows and move the cached totals.
   *
   * Two passes, and only two. The action's XP lands first because XP_500 has
   * to see the total the action produced — a student pushed over 500 by the
   * quiz they just passed must get the badge in that same response, not on
   * whatever they happen to do next. The second pass then writes any unlocked
   * achievements and stops.
   *
   * That is sound only while AT MOST ONE achievement depends on totalXp: today
   * XP_500's own 100 XP cannot unlock anything else. Adding XP_1000 breaks the
   * assumption and needs a bounded loop instead — the catalog says so beside
   * the entry.
   */
  private async award(
    tx: Prisma.TransactionClient,
    userId: string,
    input: {
      actionAwards: XpAward[];
      previousTotal: number;
      previousLevel: number;
      streakDays: number | null;
      unlockedKeys: ReadonlySet<string>;
    },
  ): Promise<GamificationResultDto> {
    const inserted = await this.insertAwards(tx, userId, input.actionAwards);
    let total = input.previousTotal + sumAmounts(inserted);

    // What the ledger rows just written PROVE, with no counting queries.
    //
    // Every Sprint 10 achievement is a "first time" or a threshold badge, and
    // an award that was actually INSERTED is itself the evidence: a
    // STAGE_COMPLETED row means at least one stage is finished, a TASK_PASSED
    // row for a quiz means at least one quiz is passed. Counting the database
    // to rediscover that would add three queries to every action for an answer
    // already in hand.
    const snapshot: AchievementSnapshot = {
      stagesCompleted: countsOf(inserted, [
        XpSource.STAGE_COMPLETED,
        XpSource.TASK_PASSED,
      ]),
      quizTasksPassed: inserted.filter(
        (row) =>
          row.source === XpSource.TASK_PASSED && isQuizPassKey(row.sourceKey),
      ).length,
      wordsMastered: countsOf(inserted, [XpSource.WORD_MASTERED]),
      totalXp: total,
      currentStreakDays: input.streakDays,
    };

    const earned = newlyEarnedAchievements(snapshot, input.unlockedKeys);
    const unlockedAchievements: AchievementKey[] = [];

    if (earned.length > 0) {
      const achievementRows = await this.insertAwards(
        tx,
        userId,
        earned.map((definition) =>
          achievementAward(definition.key, definition.xp),
        ),
      );
      total += sumAmounts(achievementRows);
      for (const row of achievementRows) {
        unlockedAchievements.push(keyFromAchievementSourceKey(row.sourceKey));
      }
    }

    const xpAwarded = total - input.previousTotal;
    if (xpAwarded === 0) {
      // Every award collided, i.e. this was a replay. Nothing is written —
      // not even a no-op UPDATE — and the caller reports 0.
      return noAward(input.previousTotal);
    }

    const progress = levelProgress(total);
    await tx.user.update({
      where: { id: userId },
      // increment, NEVER read-modify-write: two concurrent awards must both
      // land. This is the whole reason UserService.updatePoints was deleted.
      data: { totalPoints: { increment: xpAwarded }, level: progress.level },
    });

    return {
      xpAwarded,
      // The whole curve, not just the new total — see GamificationResultDto.
      // levelProgress is pure, so this is the same `levelForXp` the column
      // caches plus the four numbers the level widget draws.
      xp: progress,
      leveledUp: progress.level > input.previousLevel,
      unlockedAchievements,
    };
  }

  /**
   * Conflict-free ledger insert. Returns the rows that ACTUALLY landed.
   *
   * createManyAndReturn, not createMany: createMany reports only a count, and
   * "1 of 2 rows inserted" does not say WHICH — so a batch mixing a 10-XP and
   * a 30-XP award could not be totalled correctly. Every award in this system
   * would eventually be wrong by a quiet, plausible-looking amount.
   */
  private async insertAwards(
    tx: Prisma.TransactionClient,
    userId: string,
    awards: XpAward[],
  ) {
    if (awards.length === 0) return [];
    return tx.xpTransaction.createManyAndReturn({
      data: awards.map((award) => ({ userId, ...award })),
      skipDuplicates: true,
      select: { amount: true, source: true, sourceKey: true },
    });
  }

  // --- read path ------------------------------------------------------------

  /**
   * GET /gamification/profile.
   *
   * SIX QUERIES, FIXED. Adding an achievement must never add a query: a badge
   * needing new data adds a FIELD to AchievementSnapshot, filled by widening
   * one of these six. A per-achievement count would be an N+1 that grows with
   * the catalog.
   *
   * Completion counts use the account-wide publication filter
   * (shared/published-scope.ts), the same one the dashboard applies, so a badge
   * and the dashboard cannot disagree about what a finished stage is.
   */
  async buildProfile(userId: string): Promise<GamificationProfileDto> {
    const [user, stepsCompleted, tasksPassed, wordsMastered, achievementRows] =
      await Promise.all([
        this.prisma.user.findUniqueOrThrow({
          where: { id: userId },
          select: { totalPoints: true },
        }),
        this.prisma.lessonStepProgress.count({
          where: {
            userId,
            completedAt: { not: null },
            lesson: publishedLesson,
          },
        }),
        // Fetched rather than counted, so ONE query yields both the total
        // (for stagesCompleted) and the quiz-only subset (for FIRST_QUIZ_PASS).
        // Bounded by the number of tasks a student has ever passed — a few
        // hundred at most — and the same fetch-then-split shape the dashboard
        // already uses for today's attempts.
        this.prisma.lessonTaskProgress.findMany({
          where: { userId, completedAt: { not: null }, task: publishedTask },
          select: { task: { select: { type: true } } },
        }),
        this.prisma.userWordProgress.count({
          where: { userId, state: 'MASTERED' },
        }),
        this.prisma.xpTransaction.findMany({
          where: { userId, source: XpSource.ACHIEVEMENT },
          select: { sourceKey: true, createdAt: true },
        }),
      ]);

    const unlockedAt = new Map<string, Date>(
      achievementRows.map((row) => [
        keyFromAchievementSourceKey(row.sourceKey),
        row.createdAt,
      ]),
    );

    const snapshot: AchievementSnapshot = {
      stagesCompleted: stepsCompleted + tasksPassed.length,
      quizTasksPassed: tasksPassed.filter((row) => row.task.type === 'QUIZ')
        .length,
      wordsMastered,
      totalXp: user.totalPoints,
      // This endpoint does not compute a streak — see GamificationProfileDto.
      // Streak badges therefore report from the ledger alone, which is the only
      // honest answer available here.
      currentStreakDays: null,
    };

    const achievements = evaluateAchievements(snapshot, unlockedAt);

    return {
      xp: levelProgress(user.totalPoints),
      achievements,
      nextMilestoneDays:
        STREAK_MILESTONES.find(
          (days) => !unlockedAt.has(`STREAK_${days}` as AchievementKey),
        ) ?? null,
    };
  }
}

const sumAmounts = (rows: { amount: number }[]): number =>
  rows.reduce((sum, row) => sum + row.amount, 0);

const countsOf = (rows: { source: XpSource }[], sources: XpSource[]): number =>
  rows.filter((row) => sources.includes(row.source)).length;

const keyFromAchievementSourceKey = (sourceKey: string): AchievementKey =>
  sourceKey.slice('achievement:'.length) as AchievementKey;
