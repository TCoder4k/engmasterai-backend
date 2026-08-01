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
// 'trap' (Sprint 06C) is its own kind for the same reason 'answer' is: a
// correction round is one request per trap plus one per hint, so sharing
// 'submit''s tight bucket would throttle a student doing exactly what the
// stage asks of them.
//
// 'step' (Sprint 07) exists because THE KIND IS THE BUCKET — the guard keys on
// `quiz:${kind}:${userId}`, so any two route groups sharing a kind share one
// counter. Video progress posts roughly every 7 seconds while a video plays,
// ~86 of them across a 10-minute lesson. Filing those under 'answer' would
// have burned ~72% of the quiz-answering budget before the student even opened
// the quiz, surfacing as "the quiz randomly stops accepting answers" — a
// miserable bug to diagnose from that symptom.
// 'stats' (Sprint 09) is its own kind for exactly the reason 'step' is. The
// dashboard calls GET /analytics/dashboard on every visit to /home, and the
// SAME page load also calls GET /progress/courses, which is filed under 'read'.
// Sharing that bucket would consume it twice as fast on the busiest navigation
// path in the app, and the symptom — "course progress sometimes fails to
// load" — points nowhere near the analytics widget that caused it.
// 'gamification' (Sprint 10) is its own kind for exactly the reason 'stats' is.
// GET /gamification/profile backs the level widget, which StudentLayout renders
// on EVERY student page, and /home issues it alongside GET /analytics/dashboard
// ('stats') and GET /progress/courses ('read'). Filing it under 'stats' would
// drain that bucket twice as fast on the busiest navigation path in the app,
// and the symptom — "the dashboard sometimes fails to load" — points nowhere
// near the widget that caused it.
export type QuizRateLimitKind =
  | 'read'
  | 'answer'
  | 'trap'
  | 'submit'
  | 'step'
  | 'stats'
  | 'gamification'
  | 'manage';

export interface QuizRateLimitPolicy {
  kind: QuizRateLimitKind;
  max: number;
  windowSeconds: number;
}

export const QUIZ_RATE_LIMITS_KEY = 'quiz_rate_limit';

export const QuizRateLimit = (policy: QuizRateLimitPolicy) =>
  SetMetadata(QUIZ_RATE_LIMITS_KEY, policy);
