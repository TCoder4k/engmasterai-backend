import { CefrLevel } from '@prisma/client';

// Shared shapes for Speaking Partner (Phase 1+2).

/**
 * A chat bubble read aloud — short by design, not a report. Bounds the
 * translate endpoint's input length. Originally lived on the now-deleted
 * gemini-speaking-ai.provider.ts (it bounded that provider's own text
 * reply too); moved here since it's shared, not provider-specific.
 */
export const MAX_SPEAKING_REPLY_CHARS = 400;

/**
 * The ONLY shape a student-facing exercise read may return through — see
 * speaking-exercise.service.ts. A CLOSED type, not a `select`/`include` an
 * implementer reconstructs from memory: no `aiRole`, no `conversationGoal`
 * (both are hidden AI-context/steering plumbing a student could read in
 * DevTools and use to game the exercise), no `targetTurns` (nothing consumes
 * it yet — add it here the moment a real UI does, not before). Mirrors the
 * allowlist-by-TYPE discipline ChatContextResolver's LessonContextProjection
 * already established in this codebase.
 */
export interface SpeakingExerciseStudentView {
  id: string;
  title: string;
  titleVi: string;
  description: string;
  /** Vietnamese translation of `description` — added 2026-08-20 so the client can render fully in either language, never a mix. See docs/sprints/sprint-13-speaking-partner.md. */
  descriptionVi: string;
  level: CefrLevel;
  openingLine: string;
}

export interface SpeakingScenarioCardDto {
  id: string;
  name: string;
  nameVi: string;
  description: string | null;
  /** Vietnamese translation of `description` — same reasoning as SpeakingExerciseStudentView.descriptionVi. */
  descriptionVi: string | null;
  level: CefrLevel | null;
  orderIndex: number;
  exerciseCount: number;
  /** True for the one open-topic "Free Talk" scenario — see the schema comment on SpeakingScenario.isFreeTalk. */
  isFreeTalk: boolean;
}

export interface SpeakingScenarioDetailDto {
  id: string;
  name: string;
  nameVi: string;
  description: string | null;
  descriptionVi: string | null;
  level: CefrLevel | null;
  exercises: SpeakingExerciseStudentView[];
  isFreeTalk: boolean;
}

/**
 * The AI-context-only exercise fields — never the SpeakingExerciseStudentView
 * shape. Used to build both the old (retired) text-reply prompt and the
 * Speaking Live system instruction (speaking-live-instruction.ts) — moved
 * here from the now-deleted speaking-ai.provider.ts since it's no longer
 * specific to that one provider.
 */
export interface SpeakingAiExerciseContext {
  aiRole: string;
  level: CefrLevel;
  description: string;
  openingLine: string;
  conversationGoal: string | null;
}

/** One turn as stored in Redis (speaking-session.store.ts). */
export interface StoredSpeakingTurn {
  role: 'user' | 'assistant';
  text: string;
  /** Epoch ms. Internal only — never re-serialized to the client. */
  at: number;
}

export interface StartSpeakingAttemptResultDto {
  attemptId: string;
  exerciseId: string;
  startedAt: string;
  openingLine: string;
  exercise: {
    title: string;
    titleVi: string;
    level: CefrLevel;
    description: string;
    descriptionVi: string;
  };
  /**
   * Single-use, 45s-TTL credential for the /speaking/live WS handshake —
   * see speaking-live-ticket.store.ts's header for why this replaces a
   * JWT-in-query-string. Bound to this exact attemptId; consumed on
   * connect.
   */
  liveTicket: string;
}

export interface SpeakingAttemptSummaryDto {
  attemptId: string;
  exerciseId: string;
  startedAt: string;
  completedAt: string;
  turnCount: number;
}

// --- admin (manage) shapes ---------------------------------------------------

export interface ManageSpeakingScenarioDto {
  id: string;
  name: string;
  nameVi: string;
  description: string | null;
  descriptionVi: string | null;
  level: CefrLevel | null;
  orderIndex: number;
  isPublished: boolean;
  isFreeTalk: boolean;
  exerciseCount: number;
}

/** The admin surface sees everything, including aiRole/conversationGoal — this type is never used on a student-facing route. */
export interface ManageSpeakingExerciseDto {
  id: string;
  scenarioId: string;
  title: string;
  titleVi: string;
  description: string;
  descriptionVi: string;
  level: CefrLevel;
  aiRole: string;
  openingLine: string;
  conversationGoal: string | null;
  targetTurns: number;
  orderIndex: number;
  isPublished: boolean;
}
