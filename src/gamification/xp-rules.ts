import { LessonStepKind, LessonTaskType, XpSource } from '@prisma/client';

// Sprint 10 — how much every action is worth, and what its idempotency key is.
// Pure: no Prisma, no clock, no I/O.
//
// TWO RULES THIS FILE EXISTS TO ENFORCE.
//
// 1. NO AMOUNT EVER COMES FROM A CLIENT. Every award in the system is built by
//    one of the builders below, from these constants. No DTO carries an
//    `amount` field and no endpoint accepts one, so "the client sent us 9999
//    XP" is not a bug that can be written — it is a shape that does not exist.
//
// 2. sourceKey IS A PERMANENT ON-DISK CONTRACT. It is the other half of
//    XpTransaction's @@unique([userId, sourceKey]), which is what makes an
//    award exactly-once at the DATABASE level rather than by application
//    check. Change the format of an existing key after deploy and every past
//    award stops matching — every student is silently paid a second time for
//    work they already did, with no error anywhere. xp-rules.spec.ts pins each
//    format with a literal string for exactly this reason. Adding a NEW key
//    format is safe; editing an old one is not.
//
// Keys are scoped per-user by that unique constraint, so they never carry a
// userId — the same convention LessonTaskAttempt.clientAttemptId and
// WordReviewLog.clientReviewId already follow.
//
// The amounts were set by the product owner on 2026-07-31. Changing them later
// is not a neutral edit: XP already earned is never recomputed, so two
// students at the same level would have done different amounts of work.

export const XP_AWARDS = {
  VIDEO_STAGE_COMPLETED: 10,
  THEORY_STAGE_COMPLETED: 10,
  QUIZ_PASSED: 30,
  PRACTICE_PASSED: 40,
  TRAP_CLEARED: 5,
  WORD_REVIEWED: 1,
  WORD_MASTERED: 15,
} as const;

/** One entry in a batch handed to GamificationService.awardXp. */
export interface XpAward {
  source: XpSource;
  sourceKey: string;
  amount: number;
}

// --- Lesson steps -----------------------------------------------------------

/**
 * Finishing the video or theory stage of a lesson.
 *
 * Keyed by lesson + step, with no timestamp and no attempt number, because
 * LessonStepProgress.completedAt is stamped once and NEVER cleared (rewatching
 * updates lastActivityAt only). One completion per lesson-step per account for
 * the lifetime of that account is therefore both the intent and what the data
 * already guarantees.
 */
export const stageAward = (
  lessonId: string,
  step: LessonStepKind,
): XpAward => ({
  source: XpSource.STAGE_COMPLETED,
  sourceKey: `step:${lessonId}:${step}`,
  amount:
    step === LessonStepKind.VIDEO
      ? XP_AWARDS.VIDEO_STAGE_COMPLETED
      : XP_AWARDS.THEORY_STAGE_COMPLETED,
});

// --- Quiz / practice --------------------------------------------------------

/**
 * Passing a quiz or an Advanced Practice task for the FIRST time.
 *
 * Keyed by task, not by attempt: LessonTaskProgress.completedAt is set on the
 * first pass and never re-stamped on a later retry, so a student who passes,
 * retakes and passes again is paid once. Practice is worth more than quiz
 * because it is the harder, prerequisite-gated stage.
 *
 * THE TASK TYPE IS IN THE KEY EVEN THOUGH IT IS REDUNDANT. One taskId is one
 * task of one type (the schema enforces one task per type per lesson), so
 * `task:{taskId}:passed` would already be unique. It is spelled out anyway
 * because the FIRST_QUIZ_PASS achievement has to tell a quiz pass from a
 * practice pass, and the alternative was inferring it from the AMOUNT (30 vs
 * 40) — which would silently start crediting practice as a quiz the day
 * someone makes the two rewards equal. A self-describing ledger row costs
 * nothing and cannot rot that way.
 */
export const taskPassedAward = (
  taskId: string,
  taskType: LessonTaskType,
): XpAward => ({
  source: XpSource.TASK_PASSED,
  sourceKey: `task:${taskId}:${taskType}:passed`,
  amount:
    taskType === LessonTaskType.PRACTICE
      ? XP_AWARDS.PRACTICE_PASSED
      : XP_AWARDS.QUIZ_PASSED,
});

/** Does a TASK_PASSED ledger row describe a QUIZ pass? See taskPassedAward. */
export const isQuizPassKey = (sourceKey: string): boolean =>
  sourceKey.endsWith(`:${LessonTaskType.QUIZ}:passed`);

// --- Trap Hunter ------------------------------------------------------------

/**
 * Clearing one trap.
 *
 * Keyed by task + question because Trap Hunter's state lives inside the
 * `trapHunterState` JSON blob on LessonTaskProgress and has NO timestamp
 * column of its own — there is nothing else stable to key on. A trap's
 * `clearedAt` is never cleared once set (TrapHunterService.answerTrap replays
 * an already-cleared trap verbatim with no write), so this is once per trap.
 */
export const trapClearedAward = (
  taskId: string,
  questionId: string,
): XpAward => ({
  source: XpSource.TRAP_CLEARED,
  sourceKey: `trap:${taskId}:${questionId}`,
  amount: XP_AWARDS.TRAP_CLEARED,
});

// --- SRS --------------------------------------------------------------------

/**
 * Submitting one vocabulary review.
 *
 * Reuses the client's own `clientReviewId` — the idempotency key
 * LearningService already requires and WordReviewLog already stores uniquely
 * per user. A replayed review therefore collides here for exactly the same
 * reason it returns the original snapshot there: it is the same event.
 *
 * Deliberately the cheapest award in the system (1 XP). A review takes
 * seconds, and a session is dozens of them.
 */
export const wordReviewedAward = (clientReviewId: string): XpAward => ({
  source: XpSource.WORD_REVIEWED,
  sourceKey: `review:${clientReviewId}`,
  amount: XP_AWARDS.WORD_REVIEWED,
});

/**
 * A word reaching MASTERED. ONCE PER WORD PER ACCOUNT, FOREVER.
 *
 * THIS KEY DELIBERATELY CARRIES NO TIMESTAMP OR OCCURRENCE COUNT, and that is
 * a security property, not an oversight. UserWordProgress.masteredAt is NOT a
 * one-way transition: the scheduler CLEARS it on a lapse (MASTERED + AGAIN or
 * HARD, srs/scheduler.ts) and stamps it again when the word is re-mastered.
 * A key that included the occurrence would therefore mint a fresh, unclaimed
 * sourceKey on every cycle, and the loop is trivial and entirely within the
 * student's control:
 *
 *     rate AGAIN -> lapse -> re-learn -> MASTERED -> +15 XP -> repeat
 *
 * Paying only for the first time a word is ever mastered closes it completely.
 * xp-rules.spec.ts names this exact farm loop.
 */
export const wordMasteredAward = (wordId: string): XpAward => ({
  source: XpSource.WORD_MASTERED,
  sourceKey: `word:${wordId}:mastered`,
  amount: XP_AWARDS.WORD_MASTERED,
});

// --- Achievements -----------------------------------------------------------

/**
 * Unlocking an achievement.
 *
 * This row is not merely the XP payment — it IS the unlock record. Its
 * createdAt is the unlockedAt, and its uniqueness is what makes an achievement
 * unlockable once. That is why no UserAchievement table exists (see the note
 * on XpTransaction in schema.prisma), and why every achievement in the catalog
 * must grant a positive amount: a 0-XP achievement would write no row and
 * would be invisible to the profile read.
 *
 * `amount` comes from the catalog rather than a constant here, so there is one
 * place a reviewer has to look to see what a badge is worth.
 */
export const achievementAward = (key: string, amount: number): XpAward => ({
  source: XpSource.ACHIEVEMENT,
  sourceKey: `achievement:${key}`,
  amount,
});
