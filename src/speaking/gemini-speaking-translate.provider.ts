import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SpeakingTranslateError,
  SpeakingTranslateProvider,
  SpeakingTranslateRequest,
  SpeakingTranslateResult,
} from './speaking-translate.provider';

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

  constructor(private readonly config: ConfigService) {}

  get model(): string {
    // gemini-3.6-flash — see env.validation.ts's
    // GEMINI_SPEAKING_TRANSLATE_MODEL comment for why (2026-09-04: Google's
    // 3.5 line started returning 503 "high demand", surfacing to students
    // as "Không dịch được" on subtitles).
    return this.config.get<string>('GEMINI_SPEAKING_TRANSLATE_MODEL', 'gemini-3.6-flash');
  }

  async translate(request: SpeakingTranslateRequest): Promise<SpeakingTranslateResult> {
    const apiKey = this.config.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      throw new SpeakingTranslateError(
        'NOT_CONFIGURED',
        'GEMINI_API_KEY is not set; subtitle translation is unavailable',
      );
    }

    const model = this.model;
    const timeoutMs = this.config.get<number>('SPEAKING_TRANSLATE_TIMEOUT_MS', 20000);

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
        },
      );
    } catch (caught) {
      const aborted = caught instanceof Error && caught.name === 'AbortError';
      // The text being translated is NEVER logged, here or anywhere — only
      // the shape of the failure is.
      this.logger.warn(
        `Speaking translate ${aborted ? 'timed out' : 'failed'} after ${timeoutMs}ms (model=${model})`,
      );
      throw new SpeakingTranslateError(
        aborted ? 'TIMEOUT' : 'UNAVAILABLE',
        aborted ? 'Subtitle translation timed out' : 'Subtitle translation is unavailable',
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      this.logger.warn(`Speaking translate returned HTTP ${response.status} (model=${model})`);
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
