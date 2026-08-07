// Sprint 11 Phase 4B — the speech-to-text seam.
//
// >>> THE SHAPE OF THIS INTERFACE IS A SECURITY CONTROL, NOT A STYLE CHOICE <<<
//
// There is NO field for the expected sentence, and there must never be one.
// The MVP engine is Gemini — a language model — and a language model handed
// both an audio clip and "the student should have said X" will return X.
// Every student would score 100%, the failure would be invisible (the
// transcripts would look perfect), and the feature would be silently worthless.
//
// This is not a hypothetical to guard with a code review. It is prevented
// structurally: `transcribe` takes audio and a language tag, and the reference
// text is not in scope at the call site. A future provider that wants
// "biasing" or "phrase hints" for accuracy is asking for exactly this, and the
// answer is no while the transcript is used for grading.
//
// WHY AN INTERFACE AT ALL, for one implementation. Two reasons, both concrete
// rather than aspirational. (1) e2e and unit tests cannot call a paid external
// API, so the fake provider is what makes the write path testable at all —
// without this seam Phase 4B would ship with its scoring untested. (2) Gemini
// is a general model doing a specialist's job; when it is replaced by Whisper,
// Deepgram or Azure Speech, the replacement must not touch the service, the
// alignment or the schema. `TranscriptSource` records which engine spoke.

/** DI token. A string token because the interface is a type and erases at runtime. */
export const SPEECH_TO_TEXT_PROVIDER = 'SPEECH_TO_TEXT_PROVIDER';

export interface SpeechToTextRequest {
  /** The uploaded audio. In memory for the lifetime of one request, never written anywhere. */
  audio: Buffer;
  /** What the browser said it recorded, e.g. `audio/webm;codecs=opus`. */
  mimeType: string;
  /** BCP-47. The sentences are English; this is a hint, not a constraint. */
  languageCode: string;
}

export interface SpeechToTextResult {
  /** Verbatim, unnormalized. Normalization and alignment happen elsewhere, on purpose. */
  transcript: string;
}

/**
 * Every way transcription can fail, as far as the caller needs to care.
 *
 * Separated because the student-facing recovery differs: `UNAVAILABLE` and
 * `TIMEOUT` mean "try again in a moment" and the attempt was not consumed,
 * `UNSUPPORTED_AUDIO` means the recording itself is the problem, and
 * `NO_SPEECH` is not an error at all in the ordinary sense — the student was
 * not heard, which is a result they can act on.
 */
export type SpeechToTextFailureKind =
  | 'UNAVAILABLE'
  | 'TIMEOUT'
  | 'UNSUPPORTED_AUDIO'
  | 'NOT_CONFIGURED';

export class SpeechToTextError extends Error {
  constructor(
    readonly kind: SpeechToTextFailureKind,
    message: string,
  ) {
    super(message);
    this.name = 'SpeechToTextError';
  }
}

export interface SpeechToTextProvider {
  /** Which engine this is. Recorded on every attempt row it produces. */
  readonly source: 'GEMINI';
  transcribe(request: SpeechToTextRequest): Promise<SpeechToTextResult>;
}
