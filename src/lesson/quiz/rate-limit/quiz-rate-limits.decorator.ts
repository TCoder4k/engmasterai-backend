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
// 'study' (Sprint 10.5) is its own kind for exactly the reason 'step' is, and
// against the same neighbour. POST /study-time/heartbeat fires once a minute
// for as long as a student is actively learning — on the SAME pages where the
// video player is already posting progress under 'step' roughly every seven
// seconds. Sharing that bucket would let a long lesson exhaust it, and the
// symptom — "video progress stops saving after a while" — points nowhere near
// the heartbeat that drained it.
export type QuizRateLimitKind =
  | 'read'
  | 'answer'
  | 'trap'
  | 'submit'
  | 'step'
  | 'stats'
  | 'gamification'
  | 'study'
  // Sprint 11 Phase 4A. Its own bucket because a dictation sitting is many
  // small writes from one page: fifteen sentences at three tries each is 45
  // submissions, and sharing `submit` (30/600s) would throttle precisely the
  // student practising hardest. Named for what it is — there is no speech in
  // this path; Shadowing's kind, if it needs one, arrives with Shadowing.
  | 'dictation'
  // Sprint 11 Phase 4B. Its own bucket for a reason none of the others have:
  // every request in it costs money at an external speech provider. Sharing
  // `dictation` would let typed practice drain the budget that guards a paid
  // API, and the symptom — "speaking practice randomly stops working" — points
  // nowhere near the typing that caused it.
  | 'speech'
  // Sprint 11 Phase 4C. Its own bucket even though it shares `speech`'s reason
  // — a paid external call — precisely BECAUSE it shares it. Filing AI feedback
  // under `speech` would let a student who asks for coaching on six sentences
  // exhaust the budget for submitting attempts at all, and the symptom
  // ("speaking practice stopped accepting recordings") points nowhere near the
  // feedback button that drained it. It is also the cheaper request to lose:
  // feedback is optional, submitting an attempt is the feature.
  | 'aiFeedback'
  | 'manage'
  // Personalized Onboarding & Placement Test (Phase 3). Its own bucket for
  // the same reason 'answer' is its own bucket: one attempt writes up to 12
  // of these, and sharing 'placementSubmit''s tight bucket would throttle a
  // student honestly working through the 12-question test they were given.
  | 'placementAnswer'
  // Covers PUT /placement/goal, POST /placement/start(-beginner) and
  // POST /placement/attempt/:id/submit. Budget check against the MVP spec: a
  // full attempt is start(1) + up to 12x answer + submit(1) = 14 requests,
  // only 2 of which are this kind — two full retakes inside one 10-minute
  // window is 4 calls, comfortably inside 30/600, so this bucket can never
  // contradict the product's "unrestricted retakes" policy.
  | 'placementSubmit'
  // Split from 'placementSubmit' for the same reason 'aiFeedback' is split
  // from 'speech': optional AI roadmap narration must never drain the budget
  // for the actual test flow.
  | 'placementAnalysis';

export interface QuizRateLimitPolicy {
  kind: QuizRateLimitKind;
  max: number;
  windowSeconds: number;
}

export const QUIZ_RATE_LIMITS_KEY = 'quiz_rate_limit';

export const QuizRateLimit = (policy: QuizRateLimitPolicy) =>
  SetMetadata(QUIZ_RATE_LIMITS_KEY, policy);
