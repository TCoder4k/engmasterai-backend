import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PronunciationFeedbackError,
  PronunciationFeedbackProvider,
  PronunciationFeedbackRequest,
  PronunciationFeedbackResult,
} from './pronunciation-feedback.provider';
import { normaliseMimeForProvider } from './gemini-speech-to-text.provider';

// Sprint 11 Phase 4C — pronunciation coaching via the Gemini REST API.
//
// PLAIN `fetch`, NO SDK, for the same reasons as the transcription provider:
// Node 22 has global fetch, this is one POST, and the request shape stays
// visible in the file where the prompt lives.
//
// >>> THIS PROVIDER IS TOLD THE REFERENCE SENTENCE, AND THAT IS THE WHOLE
// >>> REASON IT IS A SEPARATE FILE FROM THE TRANSCRIBER.
// Nothing it returns is graded. If that ever stops being true, this class
// becomes a scoring exploit rather than a feature — see the header of
// pronunciation-feedback.provider.ts.
//
// TEMPERATURE IS NOT ZERO HERE, unlike transcription. A transcript that varies
// between identical requests cannot be explained to a student; a piece of
// coaching that is worded slightly differently is simply coaching. It is kept
// low so the ADVICE does not swing between requests, only the wording.

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * The cap on what comes back, in characters.
 *
 * A model asked for feedback will happily write an essay. This bounds what is
 * stored, what is sent over the wire and what a student has to read before they
 * can try the sentence again — the value of this feature is two or three things
 * to fix, not a report.
 */
export const MAX_FEEDBACK_CHARS = 900;

/**
 * Deliberately specific about what NOT to do.
 *
 * Every negative clause is load-bearing:
 *  - "no score, no percentage, no rating" — the app has exactly one number for
 *    this attempt and it came from the alignment. A second number invented by a
 *    model, sitting on the same screen, is two answers to one question.
 *  - "do not repeat the sentence back" — the default behaviour is to fill the
 *    response with the text it was given, which the student is already looking
 *    at.
 *  - "if you cannot hear speech, say so" — the honest answer to silence, and
 *    the alternative is a model inventing advice about a recording of nothing.
 */
const FEEDBACK_PROMPT = [
  'You are a friendly English pronunciation coach for a Vietnamese learner.',
  'You are given a target sentence, an automatic transcript of the learner reading it, and the audio itself.',
  'Listen to the audio and give short, practical feedback on their PRONUNCIATION.',
  'Name at most three specific words or sounds and say concretely how to fix each one.',
  'Be encouraging and mention one thing they did well.',
  'Do not give a score, a percentage, a rating or a grade of any kind.',
  'Do not repeat the whole sentence back to them.',
  'If you cannot hear any speech, say that you could not hear them clearly and stop.',
  'Answer in Vietnamese, in plain prose, under 120 words.',
].join(' ');

interface GeminiResponseShape {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string;
  }[];
  promptFeedback?: { blockReason?: string };
}

@Injectable()
export class GeminiPronunciationFeedbackProvider
  implements PronunciationFeedbackProvider
{
  private readonly logger = new Logger(GeminiPronunciationFeedbackProvider.name);

  constructor(private readonly config: ConfigService) {}

  get model(): string {
    return this.config.get<string>('GEMINI_FEEDBACK_MODEL', 'gemini-2.5-flash');
  }

  async generate(
    request: PronunciationFeedbackRequest,
  ): Promise<PronunciationFeedbackResult> {
    const apiKey = this.config.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      // Distinct from UNAVAILABLE: nothing is wrong with the network, the
      // deployment simply has no key. Telling an operator "the service is
      // unavailable" for a missing config value sends them to the wrong place.
      throw new PronunciationFeedbackError(
        'NOT_CONFIGURED',
        'GEMINI_API_KEY is not set; AI pronunciation feedback is unavailable',
      );
    }

    const model = this.model;
    const timeoutMs = this.config.get<number>(
      'SHADOWING_FEEDBACK_TIMEOUT_MS',
      25000,
    );

    // A bounded wait, always. Without it a hung provider holds the request, the
    // student's browser and a connection until something else gives up first.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(
        `${GEMINI_ENDPOINT}/${encodeURIComponent(model)}:generateContent`,
        {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            // Header, not a query parameter: a key in a URL ends up in access
            // logs, proxy logs and error reports.
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: FEEDBACK_PROMPT },
                  { text: `Target sentence: ${request.referenceText}` },
                  { text: `Automatic transcript: ${request.transcript}` },
                  {
                    inline_data: {
                      mime_type: normaliseMimeForProvider(request.mimeType),
                      data: request.audio.toString('base64'),
                    },
                  },
                ],
              },
            ],
            generationConfig: {
              // Low, not zero — see the file header.
              temperature: 0.3,
              maxOutputTokens: 512,
            },
          }),
        },
      );
    } catch (caught) {
      const aborted = caught instanceof Error && caught.name === 'AbortError';
      // The audio is NOT logged, here or anywhere. Only the shape of the
      // failure is, because a student's voice must not end up in a log file.
      this.logger.warn(
        `Gemini feedback ${aborted ? 'timed out' : 'failed'} after ${timeoutMs}ms`,
      );
      throw new PronunciationFeedbackError(
        aborted ? 'TIMEOUT' : 'UNAVAILABLE',
        aborted ? 'AI feedback timed out' : 'AI feedback is unavailable',
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      this.logger.warn(`Gemini feedback returned HTTP ${response.status}`);
      throw new PronunciationFeedbackError(
        response.status === 400 ? 'UNSUPPORTED_AUDIO' : 'UNAVAILABLE',
        `AI feedback failed with status ${response.status}`,
      );
    }

    let payload: GeminiResponseShape;
    try {
      payload = (await response.json()) as GeminiResponseShape;
    } catch {
      throw new PronunciationFeedbackError(
        'UNAVAILABLE',
        'AI feedback returned no data',
      );
    }

    if (payload.promptFeedback?.blockReason) {
      this.logger.warn(
        `Gemini blocked the feedback request: ${payload.promptFeedback.blockReason}`,
      );
      throw new PronunciationFeedbackError(
        'UNSUPPORTED_AUDIO',
        'The recording could not be processed',
      );
    }

    const text = payload.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? '')
      .join('')
      .trim();

    // AN EMPTY ANSWER IS A FAILURE HERE, unlike an empty transcript.
    // "The engine heard no speech" is a result a student can act on; "the
    // coach had nothing to say" is not — it would render as a blank box under
    // a button they just pressed. Reported as UNAVAILABLE so the retry copy
    // applies, which is the correct recovery.
    if (!text) {
      throw new PronunciationFeedbackError(
        'UNAVAILABLE',
        'AI feedback returned an empty answer',
      );
    }

    return { feedback: truncateFeedback(text) };
  }
}

/**
 * Bound the stored answer, cutting at a sentence end where there is one.
 *
 * Exported for tests. A hard slice mid-word reads as a bug in the app rather
 * than as a long answer, which is why the last full stop wins when it is not
 * absurdly early.
 */
export const truncateFeedback = (raw: string): string => {
  const text = raw.trim();
  if (text.length <= MAX_FEEDBACK_CHARS) return text;

  const cut = text.slice(0, MAX_FEEDBACK_CHARS);
  const lastStop = Math.max(
    cut.lastIndexOf('. '),
    cut.lastIndexOf('! '),
    cut.lastIndexOf('? '),
    cut.lastIndexOf('\n'),
  );
  // Only honour a sentence break in the last third; earlier than that and the
  // truncation would throw away most of the answer to gain a tidy full stop.
  if (lastStop > MAX_FEEDBACK_CHARS * 0.66) return cut.slice(0, lastStop + 1);
  return `${cut.trimEnd()}…`;
};
