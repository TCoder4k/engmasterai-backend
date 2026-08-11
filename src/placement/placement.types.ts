import {
  CefrLevel,
  CourseType,
  LearningGoal,
  QuestionDifficulty,
  QuestionType,
} from '@prisma/client';
import { QuestionOption } from '../lesson/quiz/grade-question';

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
  imageUrl: string | null;
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

// GET /placement/roadmap — Phase 4. courseTitle/courseThumbnail are joined
// fresh from a LIVE Course row on every read (never denormalized into
// Roadmap.items — see roadmap-algorithm.ts's header note), so an item whose
// course has since been unpublished or deleted is dropped entirely rather
// than shown with stale data.
export interface RoadmapItemViewDto {
  phase: number;
  courseType: CourseType;
  courseId: string;
  courseTitle: string;
  courseThumbnail: string | null;
  reason: string;
}

export interface RoadmapViewDto {
  goal: LearningGoal;
  estimatedLevel: CefrLevel | null;
  // Null on the beginner-skip path — no test was ever taken.
  placementAttemptId: string | null;
  generatedAt: string;
  // Phase 6 (AI roadmap narration) populates this; null until then and for
  // any roadmap nobody has asked to narrate — see Roadmap.aiSummary's
  // schema comment.
  aiSummary: string | null;
  items: RoadmapItemViewDto[];
}
