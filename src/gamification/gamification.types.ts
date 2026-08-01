import { AchievementKey, EvaluatedAchievement } from './achievement-catalog';
import { LevelProgress, levelProgress } from './level-curve';

// Sprint 10 — the shapes the gamification engine hands back.

/**
 * What a single learning action earned. EPHEMERAL — this is the one rule that
 * matters about this type.
 *
 * It must NEVER be embedded in a body that gets persisted and replayed.
 * SubmitQuizResponseDto is stored verbatim in LessonTaskAttempt.result and
 * LessonTaskProgress.lastSubmitResult and returned byte-for-byte when a client
 * replays a clientAttemptId; ReviewResponseDto is rebuilt from WordReviewLog
 * the same way. Putting `xpAwarded: 30` inside either would make a replay
 * re-announce an award that did not happen — the toast fires twice while the
 * ledger, correctly, holds one row.
 *
 * So every hook returns an outcome PAIR: the persisted body untouched, and
 * this beside it. The controller merges them at the edge. See
 * TaskSubmitOutcome / StepWriteOutcome.
 */
export interface GamificationResultDto {
  /** XP actually written to the ledger by this call. 0 on a replay. */
  xpAwarded: number;
  /**
   * The FULL level state after this call, not just the new total.
   *
   * Reuses LevelProgress verbatim, exactly as GamificationProfileDto does, and
   * for the same reason: the level widget draws `percent`, `intoLevel` and
   * `toNextLevel`, and a client that only received `totalXp` + `level` would
   * have to re-derive them from a second copy of the curve. Sprint 10 QA found
   * precisely that — the toast said "+30 XP" while the progress bar kept the
   * fill it had at sign-in, because those three fields were never sent.
   *
   * Deriving them here costs nothing: levelProgress is pure and the total is
   * already in hand.
   */
  xp: LevelProgress;
  /** True only when this call moved the student up a level. */
  leveledUp: boolean;
  /** Achievements unlocked by this call — never ones already held. */
  unlockedAchievements: AchievementKey[];
}

/**
 * Nothing was earned. Used on replays and on actions that award nothing.
 *
 * Takes only the total: User.level is a CACHE of levelForXp(totalPoints)
 * (schema.prisma), so deriving the level here is strictly more consistent than
 * passing the stored column through — a stale cache cannot leak into a
 * response that had nothing to report in the first place.
 */
export const noAward = (totalXp: number): GamificationResultDto => ({
  xpAwarded: 0,
  xp: levelProgress(totalXp),
  leveledUp: false,
  unlockedAchievements: [],
});

/** What the caller has just persisted, and what it should earn. */
export interface RecordProgressInput {
  /** When the action happened. Passed in, never read from the clock here. */
  at: Date;
  /** Awards for the action itself. May be empty (e.g. a mid-video progress tick). */
  awards: import('./xp-rules').XpAward[];
  /**
   * Whether this action makes today an ACTIVE DAY.
   *
   * False for Trap Hunter — see shared/activity-window.ts. It earns XP but is
   * invisible to the dashboard's activity scan today, and creating a day row
   * for it would light up calendar tiles that Sprint 09 does not, silently
   * changing existing students' streaks.
   */
  countsAsActivity: boolean;
  /**
   * The previous `lastActivityAt` for this lesson-step, when the caller
   * already has it in hand.
   *
   * Pure cost control for the video hot path: a 10-minute lesson posts ~86
   * progress reports, and LessonStepService's transaction has already read the
   * existing row. If that timestamp is on today's date, the activity row for
   * today must already exist and the upsert can be skipped outright.
   */
  knownLastActivityAt?: Date | null;
}

/** GET /gamification/profile. */
export interface GamificationProfileDto {
  /**
   * Reuses LevelProgress verbatim rather than restating its five fields, so
   * the wire shape and the pure function that produces it cannot drift.
   */
  xp: LevelProgress;
  achievements: EvaluatedAchievement[];
  /**
   * The next streak length worth chasing, or null once every streak badge is
   * held. Derived from WHICH STREAK BADGES ARE UNLOCKED, never from a current
   * streak — this endpoint deliberately does not compute one. The streak
   * number lives in exactly one place in the product, Sprint 09's dashboard
   * widget, and a second one here would eventually disagree with it.
   */
  nextMilestoneDays: number | null;
}
