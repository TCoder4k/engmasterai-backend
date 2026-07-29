import { PracticeBlockedReason } from './quiz.exceptions';

// Sprint 06D — when may a student start Advanced Practice?
//
// PURE: no I/O, no Prisma, nothing async — the same contract grade-question.ts
// and trap-hints.ts hold, and for the same reason. This decides whether a
// stage opens, so it needs to be readable in one screen and testable without
// a database.
//
// THE RULE THIS FILE EXISTS TO GET RIGHT: prerequisites are satisfied by
// ABSENCE as well as by completion. An earlier draft of this sprint gated
// Practice on "the quiz is passed" alone, which quietly meant a lesson with a
// Practice task and NO quiz could never satisfy its own requirement — the
// stage would sit blocked forever and the lesson could never reach 100%.
// A missing prerequisite must never create an impossible one; the same
// principle already keeps Trap Hunter out of `availableStages()` when a
// lesson has no quiz to derive traps from.
//
// The two prerequisites, and why each is shaped the way it is:
//
//   1. QUIZ — satisfied when there is no published quiz, OR the student has
//      passed it. Practice extends what the quiz checked, so on a lesson that
//      checks nothing there is nothing to extend from and no reason to wait.
//
//   2. TRAPS — considered ONLY when a quiz exists, because traps are derived
//      from a quiz attempt and from nothing else (see trap-hunter.service.ts).
//      Satisfied when the attempt produced no mistakes, or every one has been
//      corrected. Sending a student to harder material while they still have
//      uncorrected errors is exactly the sequencing this stage order exists
//      to prevent.
//
// Theory is deliberately NOT here. It is stored device-locally
// (services/lessonProgress.ts), so the server cannot verify it and must not
// pretend to: the UI shows the full chain including Theory, and the server
// enforces the two prerequisites it can actually see. Do not add a Theory
// check here without first moving Theory to real server state.

export interface PracticePrerequisiteInput {
  // Whether the lesson has a PUBLISHED quiz task at all — not whether the
  // student has opened one.
  hasPublishedQuiz: boolean;
  quizPassed: boolean;
  // Derived from the most recent completed attempt. Both are 0 when no quiz
  // exists, and the trap rule below is skipped entirely in that case.
  trapsTotal: number;
  trapsCleared: number;
}

export type PracticePrerequisiteResult =
  | { met: true }
  | { met: false; reason: PracticeBlockedReason };

export const resolvePracticePrerequisites = (
  input: PracticePrerequisiteInput,
): PracticePrerequisiteResult => {
  // No quiz on this lesson: nothing to pass, nothing to correct.
  if (!input.hasPublishedQuiz) return { met: true };

  if (!input.quizPassed) return { met: false, reason: 'quiz_not_passed' };

  // A perfect attempt leaves trapsTotal at 0 and skips this entirely — the
  // student is not made to wait for a stage that had nothing to do.
  if (input.trapsTotal > 0 && input.trapsCleared < input.trapsTotal) {
    return { met: false, reason: 'traps_outstanding' };
  }

  return { met: true };
};
