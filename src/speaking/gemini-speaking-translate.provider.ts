import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SpeakingTranslateError,
  SpeakingTranslateProvider,
  SpeakingTranslateRequest,
  SpeakingTranslateResult,
} from './speaking-translate.provider';
import { DEFAULT_GEMINI_MODEL_CHAIN, parseGeminiModelList } from '../shared/gemini-models';
import { fetchGeminiWithFallback, isGeminiTimeout } from '../shared/gemini-fetch-with-fallback';

// Speaking Partner — on-demand subtitle translation via the Gemini REST API.
//
// PLAIN `fetch`, NO SDK, matching every other Gemini provider in this
// codebase. SINGLE-TURN, no history, no exercise persona — a translation
// request has nothing to do with the conversation's context, only the one
// sentence handed to it.

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

const TRANSLATE_SYSTEM_INSTRUCTION = [
  'You are a translation engine, not a conversational assistant.',
  'Translate the English sentence you are given into natural, conversational Vietnamese, the way a fluent bilingual speaker would say it out loud.',
  'Return ONLY the Vietnamese translation — no quotes, no labels, no explanation, no English.',
].join(' ');

interface GeminiResponseShape {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string;
  }[];
  promptFeedback?: { blockReason?: string };
}

@Injectable()
export class GeminiSpeakingTranslateProvider implements SpeakingTranslateProvider {
  private readonly logger = new Logger(GeminiSpeakingTranslateProvider.name);
  private readonly models: string[];

  constructor(private readonly config: ConfigService) {
    // A chain, not a single model — see env.validation.ts's
    // GEMINI_SPEAKING_TRANSLATE_MODEL comment for the 2026-09-04 outage
    // that motivated this. Falls through to the next model on 429/503 —
    // see gemini-fetch-with-fallback.ts.
    this.models = parseGeminiModelList(
      this.config.get<string>('GEMINI_SPEAKING_TRANSLATE_MODEL', DEFAULT_GEMINI_MODEL_CHAIN),
      'GEMINI_SPEAKING_TRANSLATE_MODEL',
    );
  }

  async translate(request: SpeakingTranslateRequest): Promise<SpeakingTranslateResult> {
    const apiKey = this.config.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      throw new SpeakingTranslateError(
        'NOT_CONFIGURED',
        'GEMINI_API_KEY is not set; subtitle translation is unavailable',
      );
    }

    const timeoutMs = this.config.get<number>('SPEAKING_TRANSLATE_TIMEOUT_MS', 20000);

    let response: Response;
    try {
      ({ response } = await fetchGeminiWithFallback(
        this.models,
        timeoutMs,
        (m) => `${GEMINI_ENDPOINT}/${encodeURIComponent(m)}:generateContent`,
        (_m, signal) => ({
          method: 'POST',
          signal,
          headers: {
            'Content-Type': 'application/json',
            // Header, not a query parameter — a key in a URL ends up in
            // access logs, proxy logs and error reports.
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: TRANSLATE_SYSTEM_INSTRUCTION }] },
            contents: [{ role: 'user', parts: [{ text: request.text }] }],
            generationConfig: {
              // Zero — a translation has one correct-enough answer, unlike
              // the AI reply's conversational prose.
              temperature: 0,
              maxOutputTokens: 200,
            },
          }),
        }),
        this.logger,
        'speaking-translate',
      ));
    } catch (caught) {
      const aborted = isGeminiTimeout(caught);
      // The text being translated is NEVER logged, here or anywhere — only
      // the shape of the failure is.
      this.logger.warn(
        `Speaking translate ${aborted ? 'timed out' : 'failed'} after ${timeoutMs}ms`,
      );
      throw new SpeakingTranslateError(
        aborted ? 'TIMEOUT' : 'UNAVAILABLE',
        aborted ? 'Subtitle translation timed out' : 'Subtitle translation is unavailable',
      );
    }

    if (!response.ok) {
      this.logger.warn(`Speaking translate returned HTTP ${response.status}`);
      throw new SpeakingTranslateError(
        'UNAVAILABLE',
        `Subtitle translation failed with status ${response.status}`,
      );
    }

    let payload: GeminiResponseShape;
    try {
      payload = (await response.json()) as GeminiResponseShape;
    } catch {
      throw new SpeakingTranslateError('UNAVAILABLE', 'Subtitle translation returned no data');
    }

    if (payload.promptFeedback?.blockReason) {
      this.logger.warn(
        `Gemini blocked a speaking translate request: ${payload.promptFeedback.blockReason}`,
      );
      throw new SpeakingTranslateError('BLOCKED', 'The text could not be translated');
    }

    const text = payload.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? '')
      .join('')
      .trim();

    if (!text) {
      throw new SpeakingTranslateError('UNAVAILABLE', 'Subtitle translation returned an empty reply');
    }

    return { textVi: text };
  }
}
