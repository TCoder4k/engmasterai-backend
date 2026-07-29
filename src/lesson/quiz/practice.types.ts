import { QuizFeedbackMode } from '@prisma/client';
import { PracticeBlockedReason } from './quiz.exceptions';
import { StudentQuizDto } from './quiz.types';

// Sprint 06D — Advanced Practice response shapes.
//
// Advanced Practice reuses the quiz engine's question and grading contracts
// wholesale (see quiz.types.ts) — the types below add only what is genuinely
// new: whether the stage may be entered, and why not when it may not.

// Why the student can or cannot start.
//
// Follows the Trap Hunter convention from Sprint 06C rather than inventing a
// second one: the GET always succeeds and DESCRIBES the state. A read that
// refuses to answer forces the client to infer the reason from a status code,
// and the UI needs the difference — "not in this lesson" and "clear your traps
// first" are different messages, and one of them is discouraging when shown in
// place of the other.
//
// The three states map exactly onto the frontend's StageStatus vocabulary:
//   unavailable -> no published task; the stage does not apply here
//   blocked     -> a real stage whose prerequisite is not met yet
//   available   -> not_started / in_progress / completed, per progress
export type PracticeAvailabilityDto =
  | { state: 'available' }
  | { state: 'unavailable'; reason: 'no_published_task' }
  | { state: 'blocked'; reason: PracticeBlockedReason };

// Everything the intro screen needs, and nothing that would require starting
// an attempt to learn. Real authored numbers only — no estimated duration,
// because none is stored and inventing one would be a fabricated number in
// front of a student.
export interface PracticeTaskSummaryDto {
  taskId: string;
  questionCount: number;
  passingScorePercent: number;
  feedbackMode: QuizFeedbackMode;
}

export interface PracticeProgressDto {
  attemptsCount: number;
  bestScorePercent: number | null;
  passed: boolean;
  lastDurationSeconds: number | null;
}

// GET /lessons/:lessonId/practice
//
// `attempt` is non-null ONLY when one is genuinely in flight. That is what
// keeps this read free of side effects: with no attempt there is nothing to
// resume, so no questions are sent and no shuffle seed has to be minted —
// and minting one is a write. The intro renders from `task` alone.
export interface GetPracticeResponseDto {
  availability: PracticeAvailabilityDto;
  task: PracticeTaskSummaryDto | null;
  progress: PracticeProgressDto;
  attempt: StudentQuizDto | null;
}

// POST /lessons/:lessonId/practice/start — prerequisites enforced here, not
// on the read. Idempotent: an attempt already in flight comes back untouched.
export interface StartPracticeResponseDto {
  task: PracticeTaskSummaryDto;
  progress: PracticeProgressDto;
  attempt: StudentQuizDto;
}

// One row per published lesson in a course, for every stage that has a
// backend. Replaces three separate course-level round trips.
//
// There is deliberately NO `prerequisitesMet` field here. The client already
// holds `quiz` and `trapHunter` for the same lesson, so deriving it costs
// nothing — whereas shipping a fourth field computed from the other three
// creates a value that can disagree with them after any partial update. The
// server stays authoritative where it matters: the mutation guard.
export interface CourseStageProgressRowDto {
  lessonId: string;
  quiz: {
    passed: boolean;
    bestScorePercent: number | null;
    attemptsCount: number;
  } | null;
  trapHunter: { hasSource: boolean; total: number; cleared: number } | null;
  practice: {
    passed: boolean;
    bestScorePercent: number | null;
    attemptsCount: number;
  } | null;
}
