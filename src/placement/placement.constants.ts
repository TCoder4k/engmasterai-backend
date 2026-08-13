import { CourseType, QuestionDifficulty } from '@prisma/client';

// Personalized Onboarding & Placement Test — the fixed 24-question shape: 8
// per section (Grammar/Vocabulary/Listening), 3 EASY / 3 MEDIUM / 2 HARD
// each. Defined once here so the admin coverage check (does the bank have
// enough published questions?) and the actual sampler (POST
// /placement/start) can never drift out of sync with each other.
//
// Multi-pillar roadmap revision — bumped from 12 (4/section, 2E/1M/1H) for
// better per-section signal. Deploying this change requires the question
// bank to already satisfy the NEW requirement in production BEFORE this
// code ships — the existing coverage.ready check (admin UI) only ever
// verifies the CURRENTLY-DEPLOYED requirement, so it cannot itself confirm
// readiness for a requirement that isn't live yet. Verify readiness via an
// independent one-off script against the target counts first (see the
// architecture plan), then deploy. Deploying first would 503 every
// POST /placement/start (InsufficientQuestionBankError) until content
// catches up.
export const PLACEMENT_SECTIONS: CourseType[] = [
  'GRAMMAR',
  'VOCABULARY',
  'LISTENING',
];

export const DIFFICULTY_REQUIREMENTS: Record<QuestionDifficulty, number> = {
  EASY: 3,
  MEDIUM: 3,
  HARD: 2,
};

export const QUESTIONS_PER_SECTION = Object.values(
  DIFFICULTY_REQUIREMENTS,
).reduce((sum, n) => sum + n, 0); // 8

export const TOTAL_QUESTIONS =
  QUESTIONS_PER_SECTION * PLACEMENT_SECTIONS.length; // 24

// The hard, server-authoritative time limit — computed once at attempt
// creation and never recomputed (see PlacementAttempt.expiresAt's schema
// comment). 600s / 24 questions = 25s/question, the same pace as the
// previous 12q/5min shape (not adjustable per request).
export const PLACEMENT_TIME_LIMIT_MS = 10 * 60 * 1000;
