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
