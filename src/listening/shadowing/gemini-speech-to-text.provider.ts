import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SpeechToTextError,
  SpeechToTextProvider,
  SpeechToTextRequest,
  SpeechToTextResult,
} from './speech-to-text.provider';

// Sprint 11 Phase 4B — transcription via the Gemini REST API.
//
// PLAIN `fetch`, NO SDK. Node 22 has global fetch, the call is one POST with a
// JSON body, and an SDK would add a production dependency and a version to
// track for no behaviour this needs. It also keeps the request shape visible
// in this file, which matters because the prompt below is load-bearing.
//
// >>> THE REFERENCE SENTENCE IS NEVER SENT. <<< See speech-to-text.provider.ts.
// This file has no access to it; the interface has no field for it.
//
// AN LLM IS NOT A DEDICATED STT ENGINE, and the difference shows up as prose.
// Ask a model to transcribe and it will happily answer "Sure! The audio says:
// ...", or add commentary, or describe the audio instead of transcribing it.
// Two defences, both structural rather than hopeful: a `responseSchema` so the
// answer is a JSON field rather than free text, and `temperature: 0` so the
// same audio does not produce a different transcript on a retry. Accuracy on
// real learner speech is UNMEASURED — the pass threshold cannot be trusted
// until it has been.

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Deliberately terse and negative.
 *
 * Every clause is here because a model does the opposite by default: it
 * summarises, it translates, it corrects grammar, it apologises for unclear
 * audio, and it "helpfully" writes what it thinks was meant rather than what
 * was said. For grading, a faithful transcript of a mistake is the entire
 * value — a model that silently fixes a student's error erases the thing being
 * assessed.
 */
const TRANSCRIPTION_PROMPT = [
  'Transcribe the speech in this audio clip verbatim.',
  'Write only the words that were actually spoken, in the original language.',
  'Do not translate. Do not correct grammar, pronunciation or word choice.',
  'Do not add commentary, description, or any words that were not spoken.',
  'If no speech can be heard, return an empty string.',
].join(' ');

interface GeminiResponseShape {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string;
  }[];
  promptFeedback?: { blockReason?: string };
}

@Injectable()
export class GeminiSpeechToTextProvider implements SpeechToTextProvider {
  readonly source = 'GEMINI' as const;
  private readonly logger = new Logger(GeminiSpeechToTextProvider.name);

  constructor(private readonly config: ConfigService) {}

  async transcribe(request: SpeechToTextRequest): Promise<SpeechToTextResult> {
    const apiKey = this.config.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      // Distinct from UNAVAILABLE: nothing is wrong with the network or the
      // provider, the deployment simply has no key. Telling an operator "the
      // speech service is unavailable" for a missing config value sends them
      // to look at the wrong thing.
      throw new SpeechToTextError(
        'NOT_CONFIGURED',
        'GEMINI_API_KEY is not set; speech-to-text is unavailable',
      );
    }

    // gemini-3.6-flash — see env.validation.ts's GEMINI_STT_MODEL comment
    // (2026-09-04: gemini-2.5-flash was fully retired by Google; verified
    // 3.6-flash still accepts audio inline_data before switching).
    const model = this.config.get<string>('GEMINI_STT_MODEL', 'gemini-3.6-flash');
    const timeoutMs = this.config.get<number>('SHADOWING_STT_TIMEOUT_MS', 20000);

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
                  { text: TRANSCRIPTION_PROMPT },
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
              // Same audio, same transcript. A grading input that varies
              // between identical requests cannot be explained to a student.
              temperature: 0,
              responseMimeType: 'application/json',
              responseSchema: {
                type: 'OBJECT',
                properties: { transcript: { type: 'STRING' } },
                required: ['transcript'],
              },
            },
          }),
        },
      );
    } catch (caught) {
      const aborted = caught instanceof Error && caught.name === 'AbortError';
      // The audio is NOT logged, here or anywhere. Only the shape of the
      // failure is, because a student's voice must not end up in a log file.
      this.logger.warn(
        `Gemini transcription ${aborted ? 'timed out' : 'failed'} after ${timeoutMs}ms`,
      );
      throw new SpeechToTextError(
        aborted ? 'TIMEOUT' : 'UNAVAILABLE',
        aborted ? 'Speech recognition timed out' : 'Speech recognition is unavailable',
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      this.logger.warn(`Gemini transcription returned HTTP ${response.status}`);
      // 400 here is overwhelmingly "this container is not something I can
      // decode", which is the student's recording rather than our outage.
      throw new SpeechToTextError(
        response.status === 400 ? 'UNSUPPORTED_AUDIO' : 'UNAVAILABLE',
        `Speech recognition failed with status ${response.status}`,
      );
    }

    let payload: GeminiResponseShape;
    try {
      payload = (await response.json()) as GeminiResponseShape;
    } catch {
      throw new SpeechToTextError('UNAVAILABLE', 'Speech recognition returned no data');
    }

    // A safety block is not an outage and not a bad recording. It is rare on
    // read-aloud practice audio, and it must not be reported as either.
    if (payload.promptFeedback?.blockReason) {
      this.logger.warn(
        `Gemini blocked the request: ${payload.promptFeedback.blockReason}`,
      );
      throw new SpeechToTextError(
        'UNSUPPORTED_AUDIO',
        'The recording could not be processed',
      );
    }

    const text = payload.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? '')
      .join('')
      .trim();

    // An EMPTY transcript is a legitimate answer — silence, or a student who
    // did not speak. It is returned as an empty string and scored as such,
    // never raised as an error: "you were not heard" is a result the student
    // can act on, and an exception would hide it behind a retry prompt.
    if (!text) return { transcript: '' };

    return { transcript: extractTranscript(text) };
  }
}

/**
 * Pull the transcript out of the model's JSON, tolerating a model that ignored
 * the schema and answered in prose anyway.
 *
 * The fallback returns the raw text rather than failing: a transcript that
 * arrived in the wrong wrapper is still the student's words, and refusing it
 * would turn a formatting quirk into a lost attempt. Exported for tests
 * because this is exactly the kind of tolerance that rots unnoticed.
 */
export const extractTranscript = (raw: string): string => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'transcript' in parsed &&
      typeof (parsed as { transcript: unknown }).transcript === 'string'
    ) {
      return (parsed as { transcript: string }).transcript.trim();
    }
  } catch {
    // Not JSON. Fall through.
  }
  return raw.trim();
};

/**
 * Reduce a browser MIME string to what the provider will accept.
 *
 * Browsers report `audio/webm;codecs=opus`; the codec parameter is meaningful
 * to MediaRecorder and noise to an inference API, which rejects the whole
 * string rather than ignoring the part it does not want.
 */
export const normaliseMimeForProvider = (mimeType: string): string =>
  mimeType.split(';')[0].trim().toLowerCase();
