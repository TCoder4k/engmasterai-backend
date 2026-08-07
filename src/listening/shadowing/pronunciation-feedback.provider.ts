// Sprint 11 Phase 4C — the pronunciation-coaching seam.
//
// >>> WHY THIS IS A SEPARATE INTERFACE FROM SpeechToTextProvider <<<
//
// It is separate for the same reason that one has no reference-text field: to
// make the dangerous wiring impossible rather than merely discouraged.
//
// `SpeechToTextProvider.transcribe` must NEVER be told what the student was
// supposed to say — hand a language model the audio and the expected sentence
// and it returns the expected sentence, every student scores 100%, and the
// failure is invisible because the transcripts look perfect.
//
// This interface DOES take the reference sentence, and that is safe for exactly
// one reason: nothing it returns is used for grading. The verdict has already
// been computed and persisted before a word of feedback is requested. What
// comes back here is prose shown to the student, and it changes no score, no
// progress row and no pass flag.
//
// Two interfaces keep those facts apart at the type level. One interface with
// an optional `referenceText` would be one careless call site away from
// destroying the entire measurement, and the code review that catches it would
// have to happen every time.
//
// WHAT THIS IS NOT: a pronunciation ASSESSMENT. No number comes back, and the
// DTO has no field for one. The engine hears one clip with no baseline for this
// speaker's voice, no phoneme model and no reference recording; anything
// numeric it produced would be a fabricated measurement wearing the costume of
// one. Prose that a learner can act on is the honest ceiling here.

/** DI token. A string token because the interface is a type and erases at runtime. */
export const PRONUNCIATION_FEEDBACK_PROVIDER = 'PRONUNCIATION_FEEDBACK_PROVIDER';

export interface PronunciationFeedbackRequest {
  /** The recording, re-uploaded for this request. In memory only; never written anywhere. */
  audio: Buffer;
  /** What the browser said it recorded, e.g. `audio/webm;codecs=opus`. */
  mimeType: string;
  /** The sentence the student was asked to read. Safe HERE, and only here — see above. */
  referenceText: string;
  /**
   * What the transcription engine heard, from the stored attempt.
   *
   * Passed so the coaching can talk about the same words the student already
   * sees marked on screen. Feedback that contradicts the visible result is
   * worse than no feedback: the student has to decide which half of their own
   * screen to believe.
   */
  transcript: string;
  /** BCP-47 of the language being learned. */
  languageCode: string;
}

export interface PronunciationFeedbackResult {
  /** Plain prose for the student. Never a score, never JSON the client parses. */
  feedback: string;
}

/**
 * Every way feedback can fail, as far as the caller needs to care.
 *
 * Deliberately the same shape as `SpeechToTextFailureKind` and deliberately not
 * the same type: these two providers fail independently, and a shared union
 * would suggest a shared implementation that must not develop.
 */
export type PronunciationFeedbackFailureKind =
  | 'UNAVAILABLE'
  | 'TIMEOUT'
  | 'UNSUPPORTED_AUDIO'
  | 'NOT_CONFIGURED';

export class PronunciationFeedbackError extends Error {
  constructor(
    readonly kind: PronunciationFeedbackFailureKind,
    message: string,
  ) {
    super(message);
    this.name = 'PronunciationFeedbackError';
  }
}

export interface PronunciationFeedbackProvider {
  /** Which engine produced it. Stored per attempt so old advice stays attributable. */
  readonly model: string;
  generate(
    request: PronunciationFeedbackRequest,
  ): Promise<PronunciationFeedbackResult>;
}
