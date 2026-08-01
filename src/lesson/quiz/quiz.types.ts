import {
  QuestionDifficulty,
  QuestionType,
  QuizFeedbackMode,
} from '@prisma/client';
import { QuestionOption } from './grade-question';

// Sprint 06B response shapes. Kept in one file, mirrored by the frontend's
// services/quizService.ts types — any drift between the two is exactly the
// kind of bug Invariant 9 (below) exists to catch.

// --- Student-facing ---------------------------------------------------------

// Sprint 06B.5 — the result of a question the student has ALREADY answered
// in the current attempt. Carrying the correct answer here is not a leak:
// the student saw it the moment they answered, and this is what lets a
// mid-quiz refresh restore the feedback they were already looking at.
export interface AnsweredQuestionStateDto {
  submitted: unknown;
  isCorrect: boolean;
  correctAnswer: unknown;
  explanation: string | null;
}

// Invariant 9 (Sprint 06B.5 form): this type has no correctAnswer and no
// explanation of its own. Both appear ONLY inside `answered`, and only for
// questions the student has already answered in this attempt.
// STUDENT_QUESTION_SELECT (quiz.service.ts) enforces the base shape at the
// query level; the answered results come from a second query scoped by
// `id: { in: answeredIds }`, so a correct answer for an UNANSWERED question
// is never loaded into memory on this path at all.
export interface StudentQuestionDto {
  id: string;
  type: QuestionType;
  difficulty: QuestionDifficulty | null;
  content: string;
  options: QuestionOption[] | null;
  audioUrl: string | null;
  imageUrl: string | null;
  orderIndex: number;
  answered: AnsweredQuestionStateDto | null;
}

export interface StudentQuizDto {
  taskId: string;
  passingScorePercent: number;
  feedbackMode: QuizFeedbackMode;
  /**
   * The `clientAttemptId` the server is currently recording answers against,
   * or null when no attempt is in flight.
   *
   * The client MUST adopt this when present. The answer endpoint starts the
   * record over whenever it is handed an id it does not recognise, so a
   * client that invents a fresh id after losing its sessionStorage draft
   * would silently discard every answer already recorded — and then be
   * rejected at submit for questions it believes it answered. Handing the id
   * back is what makes resume-after-refresh actually resume.
   */
  currentAttemptId: string | null;
  questions: StudentQuestionDto[];
}

// Response of POST /lessons/:lessonId/quiz/answer (IMMEDIATE mode only).
export interface AnswerQuestionResponseDto {
  questionId: string;
  isCorrect: boolean;
  correctAnswer: unknown;
  explanation: string | null;
  answeredCount: number;
  totalCount: number;
  // Consecutive correct answers ending at this one, computed server-side
  // from the recorded run — the client never counts its own streak.
  currentStreak: number;
  // True once every question in the quiz has a recorded answer, i.e. the
  // attempt is ready to be finalized via POST .../submit.
  allAnswered: boolean;
}

export interface StudentQuizProgressDto {
  attemptsCount: number;
  bestScorePercent: number | null;
  passed: boolean;
  lastDurationSeconds: number | null;
}

export interface GetQuizResponseDto {
  quiz: StudentQuizDto;
  progress: StudentQuizProgressDto;
  // Sprint 07 — the stored summary of the last FINISHED attempt, or null when
  // there is none or an attempt is currently in flight.
  //
  // Non-null means "you have finished this before; here is what you scored" —
  // which is what lets the client render the stored summary instead of
  // silently restarting a quiz the student already passed.
  lastResult: SubmitQuizResponseDto | null;
}

export interface QuestionResultDto {
  questionId: string;
  isCorrect: boolean;
  submitted: unknown;
  correctAnswer: unknown;
  explanation: string | null;
}

// This is the ONLY response in the whole quiz surface that ever carries
// correct answers — see QuestionResultDto.correctAnswer above.
// Sprint 10 — what submitTask hands back internally.
//
// `response` IS THE PERSISTED BODY AND MUST STAY FREE OF GAMIFICATION.
// SubmitQuizResponseDto is written verbatim into LessonTaskAttempt.result and
// LessonTaskProgress.lastSubmitResult, and returned byte-for-byte when a client
// replays a clientAttemptId. Embedding `xpAwarded: 30` in it would make every
// replay re-announce an award that did not happen — the toast fires a second
// time while the ledger, correctly, holds one row. The bug would look like
// duplicate XP and be invisible in the data.
//
// So the two travel side by side and the controller merges them at the edge.
// Same shape and same reason as StepWriteOutcome.
export interface TaskSubmitOutcome {
  response: SubmitQuizResponseDto;
  gamification: import('../../gamification/gamification.types').GamificationResultDto;
}

export interface SubmitQuizResponseDto {
  correctCount: number;
  totalCount: number;
  accuracyPercent: number;
  passed: boolean;
  passingScorePercent: number;
  attemptsCount: number;
  bestScorePercent: number;
  // Null when the elapsed-time cap was exceeded — omitted by the frontend
  // summary rather than shown as a fabricated number.
  durationSeconds: number | null;
  results: QuestionResultDto[];
}

export interface CourseQuizProgressRowDto {
  lessonId: string;
  passed: boolean;
  bestScorePercent: number | null;
  attemptsCount: number;
}

// --- Admin-facing ------------------------------------------------------------

export interface ManageQuestionDto {
  id: string;
  type: QuestionType;
  difficulty: QuestionDifficulty | null;
  content: string;
  options: QuestionOption[] | null;
  correctAnswer: unknown;
  explanation: string | null;
  audioUrl: string | null;
  imageUrl: string | null;
  orderIndex: number;
}

export interface ManageQuizDto {
  taskId: string | null;
  isPublished: boolean;
  passingScorePercent: number | null;
  feedbackMode: QuizFeedbackMode;
  questionCount: number;
  questions: ManageQuestionDto[];
}
