import { QuestionDifficulty, QuestionType } from '@prisma/client';
import { QuestionOption } from './grade-question';
import { TrapHint } from './trap-hints';

// Sprint 06C — Trap Hunter response shapes. Mirrored by the frontend's
// services/trapHunterService.ts, the same convention quiz.types.ts follows.

// --- Stored state (LessonTaskProgress.trapHunterState) -----------------------

// One record per trap the student has interacted with. A trap they have not
// touched yet simply has no record — absence is the initial state, so no
// backfill is ever needed when a new attempt produces a new set of traps.
export interface TrapRecord {
  // FAILED correction attempts. Drives the "Need a hint?" nudge on the
  // client from 2 up; never a penalty, never a lockout.
  attempts: number;
  // Highest hint level unlocked, 0 for none. Recorded so a refresh restores
  // what the student was already reading — and for future analytics. It is
  // NOT an input to anything: see trap-hints.ts.
  hintLevel: number;
  clearedAt: string | null;
}

export interface TrapHunterState {
  // The lastClientAttemptId of the quiz attempt these traps came from.
  // Holding it inside the JSON is what makes a retake self-detecting: once
  // it stops matching, this whole record belongs to a superseded attempt.
  sourceAttemptId: string;
  traps: Record<string, TrapRecord>;
}

// --- Student-facing ----------------------------------------------------------

// One question the student got wrong in their most recent completed attempt.
//
// SEALED BY DEFAULT: an uncleared trap with `hintLevel: 0` carries no
// `correctAnswer` and no `explanation` — neither is a field of this type at
// all. They appear only inside `hints` (unlocked one level at a time, on
// purpose) or `cleared` (earned by answering correctly).
//
// Being precise about what that is: it is hygiene, NOT the security boundary
// Invariant 9 draws around the quiz GET. POST /quiz/submit already returns
// correctAnswer and explanation for every question in the attempt — that is
// exactly what QuizReviewList renders — so this client was handed all of it
// the moment the quiz finished. Sealing the trap payload keeps the UI from
// showing an unearned answer by accident; it does not pretend to withhold a
// secret the student was never given, and no test should claim it does.
export interface TrapDto {
  questionId: string;
  type: QuestionType;
  difficulty: QuestionDifficulty | null;
  content: string;
  options: QuestionOption[] | null;
  audioUrl: string | null;
  imageUrl: string | null;
  // What the student actually submitted during the quiz — the mistake this
  // trap exists to correct. Comes from the recorded attempt, never regraded.
  wrongAnswer: unknown;
  attempts: number;
  hintLevel: number;
  // How many hint levels this question can actually offer. 0 means the
  // client renders no hint control at all rather than an empty one.
  hintsAvailable: number;
  // Levels 1..hintLevel, replayed so a refresh restores the hints the
  // student had already opened.
  hints: TrapHint[];
  // Present only once the student has answered this trap correctly. Carrying
  // the answer here is not a leak — they earned it — and it is what lets a
  // completed run stay readable.
  cleared: {
    clearedAt: string;
    correctAnswer: unknown;
    explanation: string | null;
  } | null;
}

export interface TrapHunterProgressDto {
  // Whether a completed quiz attempt exists to derive traps from. This is
  // what lets the client tell 'blocked' (no attempt yet — finish the quiz)
  // apart from 'skipped' (an attempt with zero wrong answers). Without it
  // those two collapse into one indistinguishable `total: 0`.
  hasSource: boolean;
  total: number;
  cleared: number;
  // total > 0 && cleared === total. False when there is nothing to clear:
  // an empty trap set is not an achievement to report, it is a quiz that
  // needed no correction round.
  completed: boolean;
}

export interface GetTrapHunterResponseDto {
  traps: TrapDto[];
  progress: TrapHunterProgressDto;
}

export interface AnswerTrapResponseDto {
  questionId: string;
  isCorrect: boolean;
  // Revealed at the moment the student commits to a correction — the same
  // "the reveal is earned" rule POST /quiz/answer follows.
  correctAnswer: unknown;
  explanation: string | null;
  attempts: number;
  clearedCount: number;
  totalCount: number;
  // Consecutive traps cleared without a miss, counted server-side. A
  // statistic, never a reward.
  currentStreak: number;
  allCleared: boolean;
}

export interface TrapHintResponseDto {
  questionId: string;
  // The full ladder up to and including the level just unlocked, so the
  // client never has to stitch together previous responses.
  hints: TrapHint[];
  hintLevel: number;
  hintsAvailable: number;
}

export interface CourseTrapHunterProgressRowDto {
  lessonId: string;
  hasSource: boolean;
  total: number;
  cleared: number;
}
