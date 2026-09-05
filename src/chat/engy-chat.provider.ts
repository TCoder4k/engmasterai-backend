// Phase B — the Engy Chat generation seam.
//
// A DEDICATED boundary, not a reuse of SpeechToTextProvider/
// PronunciationFeedbackProvider/RoadmapAnalysisProvider/RoadmapPlannerProvider
// — same reasoning as every other provider pair in this codebase (see
// pronunciation-feedback.provider.ts's header): each Gemini call has a
// different job and a different failure story, and a shared interface would
// be one careless call site away from mixing them up. This one is
// multi-turn conversational prose; none of the others are.

/** DI token. A string token because the interface is a type and erases at runtime. */
export const ENGY_CHAT_PROVIDER = 'ENGY_CHAT_PROVIDER';

/**
 * Every way an Engy reply can fail, as far as the caller needs to care.
 *
 * Deliberately its own union, not shared with PronunciationFeedbackFailureKind
 * or RoadmapAnalysisFailureKind — these providers fail independently.
 */
export type EngyChatFailureKind = 'NOT_CONFIGURED' | 'TIMEOUT' | 'UNAVAILABLE' | 'BLOCKED';

export class EngyChatError extends Error {
  constructor(
    readonly kind: EngyChatFailureKind,
    message: string,
  ) {
    super(message);
    this.name = 'EngyChatError';
  }
}

export interface EngyChatHistoryTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface EngyChatRequest {
  /** Bounded, oldest-first, EXCLUDING the new message below. */
  history: EngyChatHistoryTurn[];
  message: string;
  /**
   * Phase C — a plain-text block built by ChatContextResolver from an
   * allowlisted projection (never raw LessonTask/Question/answer data).
   * `null`/absent for `context: GENERAL`. Attached to only the CURRENT
   * turn, not persisted into the stored/replayed history — it describes
   * "what the student is looking at right now", which can change message
   * to message.
   */
  context?: string | null;
}

export interface EngyChatResult {
  /** Plain prose. Never HTML, never JSON the client parses. */
  reply: string;
}

export interface EngyChatProvider {
  reply(request: EngyChatRequest): Promise<EngyChatResult>;
}
