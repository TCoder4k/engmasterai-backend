import {
  CefrLevel,
  CourseType,
  LearningGoal,
  LevelSource,
  QuestionDifficulty,
  QuestionType,
} from '@prisma/client';
import { QuestionOption } from '../lesson/quiz/grade-question';
import { RoadmapPillar, RoadmapResourceType } from './roadmap-algorithm';

// Sprint (Placement Test Phase 3) response shapes — mirrors quiz.types.ts's
// own separation of student-safe vs. never-served fields.

// Invariant 9's exact discipline, restated for this feature: no
// correctAnswer, no explanation. PlacementService's STUDENT_PLACEMENT_QUESTION_SELECT
// enforces this at the query level so a correct answer for an in-progress
// attempt is never even loaded into memory on this path.
export interface PlacementQuestionPublicDto {
  id: string;
  section: CourseType;
  type: QuestionType;
  difficulty: QuestionDifficulty;
  content: string;
  options: QuestionOption[] | null;
  audioUrl: string | null;
  // Listening-section items only. Spoken dialogue for client-side TTS
  // playback — never rendered as text (see PlacementQuestion.transcript's
  // schema comment). Null once a real audioUrl recording exists.
  transcript: string | null;
  imageUrl: string | null;
}

// GET /placement/attempt/:attemptId/review — "Xem chi tiết bài làm" on the
// Result screen. Deliberately POST-completion only (see
// PlacementService.getAttemptReview's guard): Invariant 9 blocks
// correctAnswer/explanation while an attempt is still in progress so a
// student can't re-fetch their way to the answer key mid-test, but once
// finalizeNow has scored the attempt, disclosing it is the whole point of
// this endpoint — the same moment lesson quizzes' own
// SubmitQuizResponse.results already discloses correctAnswer/explanation.
export interface PlacementReviewItemDto {
  questionId: string;
  section: CourseType;
  type: QuestionType;
  content: string;
  options: QuestionOption[] | null;
  audioUrl: string | null;
  transcript: string | null;
  imageUrl: string | null;
  // Null when the student never answered this question at all (distinct
  // from a wrong answer) — isCorrect is always false in that case, same
  // "absence scores as incorrect" rule finalizeNow's scoring already uses.
  submitted: unknown | null;
  isCorrect: boolean;
  correctAnswer: unknown;
  explanation: string | null;
}

export interface PlacementReviewDto {
  attemptId: string;
  items: PlacementReviewItemDto[];
}

export interface PlacementAnswerStateDto {
  questionId: string;
  submitted: unknown;
}

export interface PlacementAttemptStateDto {
  attemptId: string;
  goal: LearningGoal | null;
  startedAt: string;
  expiresAt: string;
  questions: PlacementQuestionPublicDto[];
  answers: PlacementAnswerStateDto[];
}

export interface PlacementResultDto {
  attemptId: string;
  grammarScore: number;
  vocabularyScore: number;
  listeningScore: number;
  overallScore: number;
  estimatedLevel: CefrLevel;
  durationSeconds: number | null;
  completedAt: string;
}

// GET /placement/roadmap — multi-pillar roadmap. resourceTitle/
// resourceThumbnail are joined fresh from a LIVE Course/VocabLibrary/
// ListeningCategory row on every read (never denormalized into
// Roadmap.items — see roadmap-algorithm.ts's header note), so an item whose
// resource has since been unpublished or deleted is dropped entirely rather
// than shown with stale data.
export interface RoadmapItemViewDto {
  phase: number;
  pillar: RoadmapPillar;
  resourceType: RoadmapResourceType;
  resourceId: string;
  resourceTitle: string;
  resourceThumbnail: string | null;
  reason: string;
  // Sum of estimatedStudyMinutes across the course's published lessons (see
  // shared/estimated-minutes.ts) — real, measured content-authoring data.
  // NOT a promise about how long the student will take; the frontend derives
  // an explicitly-labeled "~X tuần" ESTIMATE from this, never presents it as
  // exact. Always 0 for VOCAB_LIBRARY/LISTENING_CATEGORY items — no
  // equivalent aggregate exists for those resource types yet, and this is
  // never fabricated to look like one.
  totalEstimatedMinutes: number;
}

// GET /placement/status — wizard-internal only (never the app-wide gate,
// which reads GET /users/me's synchronous `onboarded` field instead — see
// OnboardingGateBoundary). Answers "which step should the wizard resume
// at": has a goal been chosen, is there an attempt in flight and how much
// time is left on it, has a roadmap already been generated. Deliberately
// thin — an in-progress attempt's full question content still comes from
// GET /placement/attempt, never duplicated here.
export interface PlacementStatusDto {
  onboarded: boolean;
  learningGoal: LearningGoal | null;
  hasInProgressAttempt: boolean;
  // Only non-null when hasInProgressAttempt is true.
  attemptExpiresAt: string | null;
  hasRoadmap: boolean;
}

export interface RoadmapViewDto {
  goal: LearningGoal;
  estimatedLevel: CefrLevel | null;
  // Null only for rows written before this field existed — see
  // Roadmap.levelSource's schema comment.
  levelSource: LevelSource | null;
  // Null on the beginner-skip path — no test was ever taken.
  placementAttemptId: string | null;
  generatedAt: string;
  // Populated by POST /placement/roadmap/analysis; null for any roadmap
  // nobody has asked to narrate yet — see Roadmap.aiSummary's schema comment.
  aiSummary: string | null;
  // Derived from Roadmap.aiPlanningModel !== null, not a separately stored
  // field — see PlacementService.getRoadmap. True only when POST
  // /placement/roadmap/plan actually persisted an AI-selected `items`; false
  // for the deterministic fallback, whether AI planning was never asked for,
  // failed, or returned an invalid/disallowed selection.
  aiPlanningUsed: boolean;
  items: RoadmapItemViewDto[];
}

// POST /placement/roadmap/analysis — Phase 6. Checked-before-called caching,
// same shape as ShadowingFeedbackResultDto: `cached` tells the frontend
// whether this was a fresh (paid) generation or a stored answer, purely for
// display copy — nothing behaves differently either way.
export interface RoadmapAnalysisResultDto {
  summary: string;
  generatedAt: string;
  model: string;
  cached: boolean;
}
