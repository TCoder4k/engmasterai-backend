import { SetMetadata } from '@nestjs/common';

// Sprint 06B — mirrors src/learning/rate-limit's decorator shape exactly
// (a small, generic, userId-keyed single-policy decorator), not a reuse of
// it: Learning's LearningRateLimitKind union is hardwired to review/queue
// and importing across modules for a two-line type would be a worse
// coupling than duplicating the pattern.
// 'answer' (Sprint 06B.5) is deliberately its own kind rather than reusing
// 'submit': under IMMEDIATE feedback one request per question is ordinary
// traffic, so the submit bucket's ceiling would throttle honest students
// working through a long quiz.
export type QuizRateLimitKind = 'read' | 'answer' | 'submit' | 'manage';

export interface QuizRateLimitPolicy {
  kind: QuizRateLimitKind;
  max: number;
  windowSeconds: number;
}

export const QUIZ_RATE_LIMITS_KEY = 'quiz_rate_limit';

export const QuizRateLimit = (policy: QuizRateLimitPolicy) =>
  SetMetadata(QUIZ_RATE_LIMITS_KEY, policy);
