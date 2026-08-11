import { CourseType, QuestionDifficulty } from '@prisma/client';

// Personalized Onboarding & Placement Test — the fixed 12-question shape: 4
// per section (Grammar/Vocabulary/Listening), 2 EASY / 1 MEDIUM / 1 HARD
// each. Defined once here so the admin coverage check (does the bank have
// enough published questions?) and the actual sampler (POST
// /placement/start) can never drift out of sync with each other.
export const PLACEMENT_SECTIONS: CourseType[] = [
  'GRAMMAR',
  'VOCABULARY',
  'LISTENING',
];

export const DIFFICULTY_REQUIREMENTS: Record<QuestionDifficulty, number> = {
  EASY: 2,
  MEDIUM: 1,
  HARD: 1,
};

export const QUESTIONS_PER_SECTION = Object.values(
  DIFFICULTY_REQUIREMENTS,
).reduce((sum, n) => sum + n, 0); // 4

export const TOTAL_QUESTIONS =
  QUESTIONS_PER_SECTION * PLACEMENT_SECTIONS.length; // 12

// The hard, server-authoritative time limit — computed once at attempt
// creation and never recomputed (see PlacementAttempt.expiresAt's schema
// comment). Five minutes, not adjustable per request.
export const PLACEMENT_TIME_LIMIT_MS = 5 * 60 * 1000;
