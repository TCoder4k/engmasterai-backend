import { LearningState, ReviewRating } from '@prisma/client';

/**
 * Pure, dependency-free SRS scheduler (Sprint 04 — Learning Engine). No
 * Prisma/NestJS/DB access anywhere in this file — every export is a plain
 * function of (progress snapshot, rating, now) -> (next snapshot),
 * testable in complete isolation (scheduler.spec.ts) and swappable behind
 * this same shape if a future algorithm (e.g. FSRS) ever replaces it. See
 * docs/adr/007-learning-engine-srs.md for the full rationale: why
 * SM-2-derived rather than FSRS, why `repetitions` is not reset on a
 * lapse, why Hard and Again are deliberately identical pre-graduation
 * (resolved in the UI via previewIntervals(), not by changing this
 * semantics), and why mastery requires a floor on both interval and
 * repetitions rather than being reachable from a single rating.
 */

export const GRADUATING_INTERVAL_DAYS = 1;
export const SECOND_INTERVAL_DAYS = 6;
export const EASY_GRADUATING_INTERVAL_DAYS = 4;
export const AGAIN_EASE_PENALTY = 0.2;
export const HARD_EASE_PENALTY = 0.15;
export const EASY_EASE_BONUS = 0.15;
export const MIN_EASE_FACTOR = 1.3;
export const MAX_EASE_FACTOR = 3.0;
export const HARD_INTERVAL_MULTIPLIER = 1.2;
export const EASY_INTERVAL_BONUS_MULTIPLIER = 1.3;
export const DEFAULT_EASE_FACTOR = 2.5;
export const MASTERY_MIN_INTERVAL_DAYS = 21;
export const MASTERY_MIN_REPETITIONS = 3;

export interface ProgressSnapshot {
  state: LearningState;
  easeFactor: number;
  intervalDays: number;
  repetitions: number;
  lapses: number;
  masteredAt: Date | null;
  firstLearnedAt: Date | null;
}

// A lazily-created word's starting point (§7 of the sprint plan) — never
// persisted on its own; the first real rating is applied to this in the
// same transaction that creates the row.
export const DEFAULT_NEW_PROGRESS: ProgressSnapshot = {
  state: 'NEW',
  easeFactor: DEFAULT_EASE_FACTOR,
  intervalDays: 0,
  repetitions: 0,
  lapses: 0,
  masteredAt: null,
  firstLearnedAt: null,
};

export interface SchedulerResult {
  state: LearningState;
  easeFactor: number;
  intervalDays: number;
  repetitions: number;
  lapses: number;
  nextReviewAt: Date;
  masteredAt: Date | null;
  firstLearnedAt: Date | null;
}

export interface PreviewIntervals {
  again: number;
  hard: number;
  good: number;
  easy: number;
}

// Rounds to 2 decimal places before clamping — floating-point addition
// (e.g. 2.3 + 0.15) otherwise produces values like 2.4499999999999997,
// which would silently drift further with every subsequent review over a
// word's lifetime rather than staying at the intended, exact tenths/
// hundredths precision this algorithm's constants are defined in.
const clampEase = (ease: number): number =>
  Math.min(
    MAX_EASE_FACTOR,
    Math.max(MIN_EASE_FACTOR, Math.round(ease * 100) / 100),
  );

// Pure UTC arithmetic, deliberately — server-authoritative day-granularity
// scheduling has no DST to account for as long as it never touches local
// time; see docs/adr/007-learning-engine-srs.md's timezone note (tz is a
// stored bucketing/UX concern, never part of this calculation).
const addDays = (from: Date, days: number): Date => {
  const result = new Date(from.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
};

/**
 * Computes the next scheduling state for a single rating. Every state
 * (NEW/LEARNING/REVIEW/RELEARNING/MASTERED) is handled per its own row in
 * the sprint plan's rating-semantics table (§6) — deliberately not
 * collapsed into fewer branches than the design actually specifies, since
 * AGAIN/HARD have real per-state differences (whether a lapse is counted,
 * whether mastery is demoted, whether the state changes at all).
 */
export function next(
  progress: ProgressSnapshot,
  rating: ReviewRating,
  now: Date = new Date(),
): SchedulerResult {
  let state: LearningState = progress.state;
  let easeFactor = progress.easeFactor;
  let intervalDays = progress.intervalDays;
  let repetitions = progress.repetitions;
  let lapses = progress.lapses;
  let masteredAt = progress.masteredAt;
  let firstLearnedAt = progress.firstLearnedAt;

  const preGraduation = state === 'NEW' || state === 'LEARNING';

  switch (rating) {
    case 'AGAIN': {
      if (preGraduation) {
        // NEW/LEARNING -> stays/becomes LEARNING. `repetitions` is already
        // 0 by invariant (only GOOD/EASY ever move it above 0).
        state = 'LEARNING';
        intervalDays = GRADUATING_INTERVAL_DAYS;
      } else if (state === 'REVIEW' || state === 'MASTERED') {
        // The one true "lapse" edge: only this transition increments
        // `lapses` or penalizes ease — repeated AGAINs while already
        // RELEARNING (the branch below) do neither again.
        state = 'RELEARNING';
        lapses += 1;
        easeFactor = clampEase(easeFactor - AGAIN_EASE_PENALTY);
        intervalDays = GRADUATING_INTERVAL_DAYS;
        masteredAt = null;
        // `repetitions` is deliberately NOT reset here — see the module
        // header and ADR 007: it is a lifetime "times successfully
        // recalled" counter, not "in a row since the last failure", so
        // recovery resumes ease-based scheduling instead of restarting
        // the 1-day/6-day bootstrap.
      } else {
        // Already RELEARNING — stays, no further lapse/ease penalty.
        intervalDays = GRADUATING_INTERVAL_DAYS;
      }
      break;
    }

    case 'HARD': {
      if (preGraduation) {
        // Deliberately identical to AGAIN pre-graduation (see ADR 007) —
        // the UI resolves the resulting legibility question via
        // previewIntervals(), not by inventing a different pre-graduation
        // semantics for Hard.
        state = 'LEARNING';
        intervalDays = GRADUATING_INTERVAL_DAYS;
      } else if (state === 'RELEARNING') {
        // Stays RELEARNING — only GOOD/EASY graduate a word back out of
        // relearning; Hard just nudges the short relearning interval up.
        intervalDays = Math.round(intervalDays * HARD_INTERVAL_MULTIPLIER);
      } else if (state === 'MASTERED') {
        // Explicit, unconditional demotion — Hard is a genuine "this
        // isn't solid" signal, so this never gets silently re-promoted
        // back to MASTERED within this same call (unlike GOOD/EASY, whose
        // mastery re-check is scoped to their own branch below).
        repetitions += 1;
        easeFactor = clampEase(easeFactor - HARD_EASE_PENALTY);
        intervalDays = Math.round(intervalDays * HARD_INTERVAL_MULTIPLIER);
        state = 'REVIEW';
        masteredAt = null;
      } else {
        // REVIEW
        repetitions += 1;
        easeFactor = clampEase(easeFactor - HARD_EASE_PENALTY);
        intervalDays = Math.round(intervalDays * HARD_INTERVAL_MULTIPLIER);
      }
      break;
    }

    case 'GOOD':
    case 'EASY': {
      // GOOD and EASY share one shape regardless of starting state
      // (NEW/LEARNING/REVIEW/RELEARNING/MASTERED all graduate to REVIEW):
      // the interval math is purely a function of `repetitions` *before*
      // this rating, not of which state produced that repetitions count.
      // MASTERED->GOOD/EASY correctly re-affirms MASTERED via the shared
      // mastery check below rather than ever visibly demoting it.
      const priorRepetitions = repetitions;
      repetitions += 1;
      state = 'REVIEW';
      firstLearnedAt = firstLearnedAt ?? now;

      if (rating === 'EASY') {
        easeFactor = clampEase(easeFactor + EASY_EASE_BONUS);
      }

      if (priorRepetitions === 0) {
        // First-ever graduation. EASY skips the conservative 1-day
        // graduating step in favor of a larger, confidence-signaling
        // first interval.
        intervalDays =
          rating === 'EASY'
            ? EASY_GRADUATING_INTERVAL_DAYS
            : GRADUATING_INTERVAL_DAYS;
      } else if (rating === 'GOOD' && priorRepetitions === 1) {
        // Classic SM-2 second-interval constant — GOOD only.
        intervalDays = SECOND_INTERVAL_DAYS;
      } else {
        const multiplier =
          rating === 'EASY'
            ? easeFactor * EASY_INTERVAL_BONUS_MULTIPLIER
            : easeFactor;
        intervalDays = Math.round(intervalDays * multiplier);
      }

      if (
        state === 'REVIEW' &&
        intervalDays >= MASTERY_MIN_INTERVAL_DAYS &&
        repetitions >= MASTERY_MIN_REPETITIONS
      ) {
        state = 'MASTERED';
        masteredAt = masteredAt ?? now; // never re-stamped once set
      }
      break;
    }
  }

  return {
    state,
    easeFactor,
    intervalDays,
    repetitions,
    lapses,
    nextReviewAt: addDays(now, intervalDays),
    masteredAt,
    firstLearnedAt,
  };
}

/**
 * The four hypothetical outcomes of rating `progress` right now, computed
 * via the same pure `next()` function with zero persistence — what the
 * due-queue response embeds per word (sprint plan §8/§9) so the frontend
 * never has to guess at scheduling math, and so the review UI can show
 * that Again/Hard genuinely produce the same interval for a new word
 * rather than hiding it.
 */
export function previewIntervals(
  progress: ProgressSnapshot,
  now: Date = new Date(),
): PreviewIntervals {
  return {
    again: next(progress, 'AGAIN', now).intervalDays,
    hard: next(progress, 'HARD', now).intervalDays,
    good: next(progress, 'GOOD', now).intervalDays,
    easy: next(progress, 'EASY', now).intervalDays,
  };
}
