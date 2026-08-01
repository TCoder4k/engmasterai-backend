import { Injectable } from '@nestjs/common';
import { LessonTaskType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { collectActiveDays } from '../shared/activity-window';
import { publishedLesson, publishedTask } from '../shared/published-scope';
import { startOfDayInTimeZone } from '../learning/timezone.util';
import {
  countCurrentStreak,
  enumerateDaysInTimeZone,
  formatDayInTimeZone,
} from './day-window';
import {
  ActivityAnalyticsDto,
  DashboardAnalyticsDto,
  TodayAnalyticsDto,
} from './dashboard-analytics.types';

// The activity calendar's width. The widget renders seven tiles, so seven is
// what is fetched. A longer look-back is not free: WordReviewLog is one row per
// review, and a heavy SRS user at ~200/day would have this endpoint pulling
// ~9,000 rows on every dashboard load to produce thirty booleans. When a longer
// history is genuinely wanted, the answer is a UserDailyActivity rollup or
// $queryRaw + date_trunc — not a wider scan here.
const ACTIVITY_WINDOW_DAYS = 7;

// Sprint 09 — the dashboard's time-window analytics.
//
// READ-ONLY, with exactly one deliberate exception: it bootstraps
// User.timezone when that column is still null (see resolveTimeZone). Nothing
// else here writes.
//
// QUERY COST: nine reads, and — the property that matters — that number is
// CONSTANT. It does not grow with how much the student has studied, how many
// courses exist, or how many lessons they contain. Every query is a bounded
// range scan on an index whose leading column is userId.
//
//   0     user                 (timezone resolution; serial, the rest follow)
//   1     lessonStepProgress   completedAt    today      (stages)
//   2     lessonTaskProgress   completedAt    today      (stages)
//   3     lessonTaskAttempt    submittedAt    today      (attempts)
//   4     userWordProgress     createdAt      today      (new words)
//   5     wordReviewLog        reviewedAt     today      (reviews)
//   6     lessonStepProgress   lastActivityAt window     (calendar)
//   7     lessonTaskAttempt    submittedAt    window     (calendar)
//   8     wordReviewLog        reviewedAt     window     (calendar)
//
// Plus ONE conditional write: the User.timezone bootstrap, which fires at most
// once in an account's lifetime. 1-8 run in a single Promise.all; query 0 must
// precede them because it decides where the day boundaries are.
//
// THE PUBLICATION ASYMMETRY IS DELIBERATE. Queries 1-3 filter on
// isPublished; queries 6-8 do not.
//
// Completion counts must agree with GET /progress/courses, which pins
// `isPublished: true` at every scope (see progress-scope.ts) — two surfaces
// disagreeing about the same day, with no error shown, is the silent class of
// bug this codebase keeps paying for. But an activity DAY is a historical
// fact: an admin unpublishing a course next month does not mean the student
// was not studying last Tuesday, and retroactively breaking their streak for
// an admin's action would be indefensible. Do not "fix" this into symmetry.
@Injectable()
export class DashboardAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboardAnalytics(
    userId: string,
    requestedTimeZone?: string,
  ): Promise<DashboardAnalyticsDto> {
    const effectiveTimeZone = await this.resolveTimeZone(
      userId,
      requestedTimeZone,
    );

    const now = new Date();
    const startOfToday = startOfDayInTimeZone(now, effectiveTimeZone);
    const days = enumerateDaysInTimeZone(
      now,
      effectiveTimeZone,
      ACTIVITY_WINDOW_DAYS,
    );
    // The window opens at the START of its first day, not `now - 7 days`.
    // Subtracting a duration would clip the earliest day at whatever time of
    // day it happens to be, so that tile would light up only for activity
    // later than this morning's clock time.
    const windowStart = startOfDayInTimeZone(
      new Date(`${days[0]}T12:00:00.000Z`),
      effectiveTimeZone,
    );

    // Only lessons whose lesson AND course are published contribute to
    // completion counts.
    //
    // Sprint 10 moved these two literals to src/shared/published-scope.ts,
    // unchanged, so the gamification aggregates count the same content this
    // endpoint does instead of growing a second, drifting definition. Behaviour
    // here is identical — this file's spec, query counter included, passes
    // unedited.
    const [
      stepCompletions,
      taskCompletions,
      todayAttempts,
      newWordsLearned,
      wordsReviewed,
      activeDays,
    ] = await Promise.all([
      // 1 — video/theory finished today. Index [userId, completedAt].
      this.prisma.lessonStepProgress.count({
        where: {
          userId,
          completedAt: { gte: startOfToday },
          lesson: publishedLesson,
        },
      }),
      // 2 — quiz/practice PASSED today. completedAt is stamped once, on the
      // first pass, and never re-stamped (QuizService.submitTask), so this is a
      // true completion event and a retake cannot inflate it.
      // Index [userId, completedAt], added this sprint.
      this.prisma.lessonTaskProgress.count({
        where: {
          userId,
          completedAt: { gte: startOfToday },
          task: publishedTask,
        },
      }),
      // 3 — attempts submitted today, split by task type. Index
      // [userId, submittedAt]. Selecting the type through the relation keeps
      // this one query rather than a fetch-then-map pair.
      this.prisma.lessonTaskAttempt.findMany({
        where: {
          userId,
          submittedAt: { gte: startOfToday },
          task: publishedTask,
        },
        select: { task: { select: { type: true } } },
      }),
      // 4 — words that entered this vocabulary today. Rows are created lazily
      // on a word's first rating (LearningService.attemptReview), so createdAt
      // is exactly "learned today". Index [userId, createdAt], added this
      // sprint.
      this.prisma.userWordProgress.count({
        where: { userId, createdAt: { gte: startOfToday } },
      }),
      // 5 — reviews submitted today. Index [userId, reviewedAt].
      this.prisma.wordReviewLog.count({
        where: { userId, reviewedAt: { gte: startOfToday } },
      }),
      // 6-8 — the calendar window. No publication filter (see the note above).
      // Only the timestamp column is selected: the answer needed is seven
      // booleans, so nothing else should cross the wire from Postgres.
      // Index [userId, lastActivityAt], added in Sprint 09. lastActivityAt
      // rather than completedAt because a day on which a student watched half
      // a video completed nothing but was very much an active day.
      //
      // Sprint 10 moved these three, unchanged, to shared/activity-window.ts.
      // Awarding the STREAK_3 / STREAK_7 achievements asks the same question,
      // and two implementations of "which days was this student active" would
      // eventually disagree — showing a 5-day streak here while the 3-day badge
      // never arrives. Still three queries, still one Promise.all, still nine
      // reads in total.
      collectActiveDays(this.prisma, userId, windowStart, effectiveTimeZone),
    ]);

    const quiz = todayAttempts.filter(
      (attempt) => attempt.task.type === LessonTaskType.QUIZ,
    ).length;
    const practice = todayAttempts.filter(
      (attempt) => attempt.task.type === LessonTaskType.PRACTICE,
    ).length;

    const today: TodayAnalyticsDto = {
      date: formatDayInTimeZone(now, effectiveTimeZone),
      stagesCompleted: stepCompletions + taskCompletions,
      taskAttempts: { quiz, practice, total: todayAttempts.length },
      newWordsLearned,
      wordsReviewed,
    };

    const activity: ActivityAnalyticsDto = {
      windowDays: ACTIVITY_WINDOW_DAYS,
      days: days.map((date) => ({ date, active: activeDays.has(date) })),
      currentStreakDays: countCurrentStreak(days, activeDays),
      streakCapped: days.every((date) => activeDays.has(date)),
    };

    return { effectiveTimeZone, today, activity };
  }

  // THE REQUEST'S TIMEZONE WINS, and this deliberately differs from
  // LearningService.getDueReviews, which reads the stored column and treats a
  // supplied tz as a one-time bootstrap only.
  //
  // That set-once rule exists to stop a student resetting their daily new-word
  // QUOTA by spoofing a different zone on each call (see the note on
  // User.timezone in schema.prisma). This endpoint grants nothing and gates
  // nothing — there is no quota to game by claiming to be in Auckland, only a
  // differently-bucketed set of your own numbers. Importing the constraint
  // would mean inheriting its cost with none of its benefit: User.timezone is
  // NULL for every student who has never opened a vocabulary review, which is
  // most of them, and those users would silently get UTC days. For a UTC+7
  // student that files all study between 00:00 and 07:00 under YESTERDAY —
  // the widget reads zero while they are actively working.
  //
  // The set-once WRITE is still performed, so the SRS quota gets a real
  // timezone sooner than it otherwise would. Read precedence and write
  // precedence are not the same thing here, and that is the point.
  private async resolveTimeZone(
    userId: string,
    requestedTimeZone?: string,
  ): Promise<string> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { timezone: true },
    });

    if (!user.timezone && requestedTimeZone) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { timezone: requestedTimeZone },
      });
    }

    return requestedTimeZone ?? user.timezone ?? 'UTC';
  }
}
