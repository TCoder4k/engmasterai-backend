import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ViTranslationError,
  ViTranslationProvider,
  ViTranslationRequest,
  ViTranslationResult,
} from './vi-translation.provider';

// Dictionary Phase A — translates an ALREADY-DETERMINISTIC English
// definition into Vietnamese. This is the one place in the Dictionary
// feature an AI call is allowed, and it is narrow on purpose: the model is
// never asked to produce the English definition itself (that always comes
// from free-dictionary-api.provider.ts), only to translate a sentence it
// is handed — a closed, bounded task, not open generation.
//
// PLAIN `fetch`, NO SDK; STRUCTURED OUTPUT + TEMPERATURE 0, same reasoning
// as the roadmap planner: translating the same input twice should not
// produce a different-shaped answer.

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

const TRANSLATION_PROMPT = [
  'You translate English dictionary definitions into Vietnamese for a Vietnamese English-learner.',
  'You are given one English word and its English definition.',
  'Return a short, natural Vietnamese phrase for the MEANING of the word in that sense — not a literal sentence translation, not English text, not a full sentence.',
  'Do not add any explanation, punctuation wrapper, or extra commentary — just the Vietnamese meaning itself.',
].join(' ');

interface GeminiResponseShape {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string;
  }[];
  promptFeedback?: { blockReason?: string };
}

interface RawTranslationShape {
  translation?: unknown;
}

@Injectable()
export class GeminiViTranslationProvider implements ViTranslationProvider {
  private readonly logger = new Logger(GeminiViTranslationProvider.name);

  constructor(private readonly config: ConfigService) {}

  get model(): string {
    // gemini-3.6-flash — see env.validation.ts's
    // GEMINI_DICTIONARY_TRANSLATION_MODEL comment for why (2026-09-04:
    // Google's 3.5 line started returning 503 "high demand").
    return this.config.get<string>(
      'GEMINI_DICTIONARY_TRANSLATION_MODEL',
      'gemini-3.6-flash',
    );
  }

  async translate(request: ViTranslationRequest): Promise<ViTranslationResult> {
    const apiKey = this.config.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      throw new ViTranslationError(
        'NOT_CONFIGURED',
        'GEMINI_API_KEY is not set; Vietnamese translation is unavailable',
      );
    }

    const model = this.model;
    const timeoutMs = this.config.get<number>(
      'DICTIONARY_TRANSLATION_TIMEOUT_MS',
      10000,
    );

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
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: TRANSLATION_PROMPT },
                  { text: `Word: ${request.word}` },
                  { text: `English definition: ${request.definitionEn}` },
                ],
              },
            ],
            generationConfig: {
              temperature: 0,
              responseMimeType: 'application/json',
              responseSchema: {
                type: 'OBJECT',
                properties: { translation: { type: 'STRING' } },
                required: ['translation'],
              },
            },
          }),
        },
      );
    } catch (caught) {
      const aborted = caught instanceof Error && caught.name === 'AbortError';
      this.logger.warn(
        `Gemini VI translation ${aborted ? 'timed out' : 'failed'} after ${timeoutMs}ms`,
      );
      throw new ViTranslationError(
        aborted ? 'TIMEOUT' : 'UNAVAILABLE',
        aborted ? 'VI translation timed out' : 'VI translation is unavailable',
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      this.logger.warn(`Gemini VI translation returned HTTP ${response.status}`);
      throw new ViTranslationError(
        'UNAVAILABLE',
        `VI translation failed with status ${response.status}`,
      );
    }

    let payload: GeminiResponseShape;
    try {
      payload = (await response.json()) as GeminiResponseShape;
    } catch {
      throw new ViTranslationError('UNAVAILABLE', 'VI translation returned no data');
    }

    if (payload.promptFeedback?.blockReason) {
      this.logger.warn(
        `Gemini blocked the VI translation request: ${payload.promptFeedback.blockReason}`,
      );
      throw new ViTranslationError('UNAVAILABLE', 'VI translation could not be generated');
    }

    const text = payload.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? '')
      .join('')
      .trim();

    if (!text) {
      throw new ViTranslationError('UNAVAILABLE', 'VI translation returned an empty answer');
    }

    return extractTranslation(text);
  }
}

/** Structural parsing only. Exported for tests. */
export const extractTranslation = (raw: string): ViTranslationResult => {
  let parsed: RawTranslationShape;
  try {
    parsed = JSON.parse(raw) as RawTranslationShape;
  } catch {
    throw new ViTranslationError('UNAVAILABLE', 'VI translation returned unparseable output');
  }
  if (typeof parsed.translation !== 'string' || parsed.translation.trim().length === 0) {
    throw new ViTranslationError('UNAVAILABLE', 'VI translation returned no translation');
  }
  return { translation: parsed.translation.trim() };
};
