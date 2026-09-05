// Speaking Partner — the on-demand subtitle-translation seam. A DEDICATED
// boundary, not a reuse of SPEAKING_AI_PROVIDER or DictionaryModule's own
// Gemini VI translation provider — same "own token, own env vars, own
// failure story" discipline as every other Gemini-calling feature in this
// codebase (see speaking-ai.provider.ts's own header comment).
//
// STATELESS AND ON-DEMAND BY DESIGN: unlike the AI reply, which is generated
// unconditionally on every turn, a translation is only ever requested when a
// student actually opens the subtitle toggle — folding it into the AI-reply
// call would double that call's token cost for every student who never asks
// for it. This provider takes plain text in, plain Vietnamese text out; it
// has no idea what attempt/exercise the text came from and needs none.

/** DI token. A string token because the interface is a type and erases at runtime. */
export const SPEAKING_TRANSLATE_PROVIDER = 'SPEAKING_TRANSLATE_PROVIDER';

/**
 * Every way a translation can fail, as far as the caller needs to care.
 * Deliberately its own union, not shared with SpeakingAiFailureKind or any
 * other provider's.
 */
export type SpeakingTranslateFailureKind = 'NOT_CONFIGURED' | 'TIMEOUT' | 'UNAVAILABLE' | 'BLOCKED';

export class SpeakingTranslateError extends Error {
  constructor(
    readonly kind: SpeakingTranslateFailureKind,
    message: string,
  ) {
    super(message);
    this.name = 'SpeakingTranslateError';
  }
}

export interface SpeakingTranslateRequest {
  /** Already trimmed and non-empty — the controller/DTO guarantee this before the provider ever sees it. */
  text: string;
}

export interface SpeakingTranslateResult {
  /** Plain prose Vietnamese translation. Never HTML, never JSON the client parses. */
  textVi: string;
}

export interface SpeakingTranslateProvider {
  translate(request: SpeakingTranslateRequest): Promise<SpeakingTranslateResult>;
}
