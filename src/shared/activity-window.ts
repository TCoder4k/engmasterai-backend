import { formatDayInTimeZone } from '../analytics/day-window';

// Sprint 10 — the ONE definition of "which days did this student do something
// on", shared by the two features that ask it.
//
// WHY IT IS SHARED RATHER THAN COPIED. Sprint 09's dashboard derives the
// streak it DISPLAYS from these three tables. Sprint 10 awards the STREAK_3 /
// STREAK_7 achievements and has to ask the same question. Two implementations
// would eventually disagree, and the symptom would be a student seeing "5 day
// streak" on their dashboard while the badge for 3 days never arrives — with
// nothing on screen or in the logs to explain it.
//
// Extracting this changed NO behaviour: DashboardAnalyticsService issues the
// same three queries with the same arguments and its spec, query counter
// included, passes unedited. That was the acceptance condition for doing it.
//
// THE CANONICAL DEFINITION OF AN ACTIVE DAY. Originally three sources;
// Listening (Dictation + Shadowing) was added as a fourth once both submit
// paths started calling GamificationService.recordProgress inside their own
// write transaction (dictation.service.ts / shadowing.service.ts) — every
// submitted attempt, pass or fail, counts, same as LessonTaskAttempt below:
//
//   LessonStepProgress.lastActivityAt        — video progress, theory opened/finished
//   LessonTaskAttempt.submittedAt            — a quiz or practice attempt SUBMITTED
//   WordReviewLog.reviewedAt                 — an SRS review submitted
//   ListeningDictationAttempt.submittedAt    — a dictation attempt submitted
//   ListeningShadowingAttempt.submittedAt    — a shadowing attempt submitted
//
// NOT INCLUDED, and this is a decision rather than an oversight:
//   - Trap Hunter. TrapHunterService.answerTrap writes exactly one field,
//     `trapHunterState` (JSON on LessonTaskProgress), and that table carries no
//     timestamp for it. It is invisible to this scan TODAY, so including it
//     would light up days the dashboard does not — quietly changing existing
//     users' streaks. Trap Hunter still earns XP; it just does not create an
//     activity day.
//   - POST /quiz/answer and POST /quiz/start, for the same reason: they touch
//     LessonTaskProgress columns this scan does not read.
//   - Speaking Partner and Vocab Guess practice, and Free Talk (which has no
//     Prisma model at all — Redis-only). Still genuinely deferred, unlike
//     Listening above: neither calls recordProgress yet, so extending this
//     scan to them would require the same wiring Listening just got, not
//     just a query added here.
//
// NO PUBLICATION FILTER, matching Sprint 09. An activity DAY is a historical
// fact: an admin unpublishing a course next month does not mean the student
// was not studying last Tuesday, and retroactively breaking a streak for an
// admin's action would be indefensible. (Completion COUNTS do filter — see
// published-scope.ts. The asymmetry is deliberate; do not tidy it away.)

/** The subset of PrismaService this needs — keeps the helper mockable. */
interface ActivityScanClient {
  lessonStepProgress: {
    findMany(args: unknown): Promise<{ lastActivityAt: Date }[]>;
  };
  lessonTaskAttempt: {
    findMany(args: unknown): Promise<{ submittedAt: Date }[]>;
  };
  wordReviewLog: {
    findMany(args: unknown): Promise<{ reviewedAt: Date }[]>;
  };
  listeningDictationAttempt: {
    findMany(args: unknown): Promise<{ submittedAt: Date }[]>;
  };
  listeningShadowingAttempt: {
    findMany(args: unknown): Promise<{ submittedAt: Date }[]>;
  };
}

/**
 * The set of `'YYYY-MM-DD'` day keys, in `timeZone`, on which this student did
 * anything at or after `windowStart`.
 *
 * Five queries, run together. Each selects ONLY its timestamp column: the
 * answer wanted is a handful of booleans, so nothing else should cross the
 * wire — a heavy SRS user has thousands of review rows in a week.
 */
export const collectActiveDays = async (
  prisma: ActivityScanClient,
  userId: string,
  windowStart: Date,
  timeZone: string,
): Promise<Set<string>> => {
  const [stepActivity, attemptActivity, reviewActivity, dictationActivity, shadowingActivity] =
    await Promise.all([
      prisma.lessonStepProgress.findMany({
        where: { userId, lastActivityAt: { gte: windowStart } },
        select: { lastActivityAt: true },
      }),
      prisma.lessonTaskAttempt.findMany({
        where: { userId, submittedAt: { gte: windowStart } },
        select: { submittedAt: true },
      }),
      prisma.wordReviewLog.findMany({
        where: { userId, reviewedAt: { gte: windowStart } },
        select: { reviewedAt: true },
      }),
      prisma.listeningDictationAttempt.findMany({
        where: { userId, submittedAt: { gte: windowStart } },
        select: { submittedAt: true },
      }),
      prisma.listeningShadowingAttempt.findMany({
        where: { userId, submittedAt: { gte: windowStart } },
        select: { submittedAt: true },
      }),
    ]);

  return new Set<string>([
    ...stepActivity.map((row) =>
      formatDayInTimeZone(row.lastActivityAt, timeZone),
    ),
    ...attemptActivity.map((row) =>
      formatDayInTimeZone(row.submittedAt, timeZone),
    ),
    ...reviewActivity.map((row) =>
      formatDayInTimeZone(row.reviewedAt, timeZone),
    ),
    ...dictationActivity.map((row) =>
      formatDayInTimeZone(row.submittedAt, timeZone),
    ),
    ...shadowingActivity.map((row) =>
      formatDayInTimeZone(row.submittedAt, timeZone),
    ),
  ]);
};
