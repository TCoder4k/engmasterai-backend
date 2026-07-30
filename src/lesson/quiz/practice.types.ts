import { QuizFeedbackMode } from '@prisma/client';
import { PracticeBlockedReason } from './quiz.exceptions';
import { StudentQuizDto } from './quiz.types';
import { LessonStepsDto } from '../steps/lesson-step.types';

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
// Sprint 06D shipped this without a `prerequisitesMet` field, reasoning that a
// fourth value computed from the three beside it could disagree with them.
// Sprint 07 keeps that decision HERE — the course page needs a percentage, not
// a blocked-reason string — while the lesson aggregate
// (GET /lessons/:lessonId/progress) does return `availability`. The difference
// is not inconsistency: the lesson payload is what let the client's duplicate
// copy of the rule be deleted, and a rule with one implementation has nothing
// left to disagree with. The course page derives practice status from the quiz
// and trap fields it already has, using that same single client helper.
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
  // Sprint 07 — video and theory. Never null: a lesson with no step rows
  // returns { video: null, theory: null }, which means "not started", not
  // "this lesson has no video". What content exists is decided by
  // Lesson.videoUrl / Lesson.notes, which the client already holds.
  steps: LessonStepsDto;
}
