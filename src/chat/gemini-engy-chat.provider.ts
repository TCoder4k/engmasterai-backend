import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EngyChatError,
  EngyChatProvider,
  EngyChatRequest,
  EngyChatResult,
} from './engy-chat.provider';

// Phase B — Engy Chat via the Gemini REST API.
//
// PLAIN `fetch`, NO SDK, matching every other Gemini provider in this
// codebase (gemini-speech-to-text/gemini-pronunciation-feedback/
// gemini-roadmap-analysis/gemini-vi-translation): Node 22 has global fetch,
// this is one POST, and the request shape stays visible in the file where
// the prompt lives.
//
// MULTI-TURN, unlike every provider above it — `contents` carries the
// bounded prior history (oldest-first, user/model alternating) plus the new
// message, and `systemInstruction` (a top-level field the v1beta API
// supports for exactly this) carries the persona ONCE rather than being
// repeated as a "turn" the model might start replying to.
//
// TEMPERATURE IS NOT ZERO — same reasoning as pronunciation feedback and
// roadmap analysis: conversational prose worded slightly differently between
// two calls is simply prose, not a correctness bug.

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * The cap on what comes back, in characters. Comparable to pronunciation
 * feedback's 900 — this is a chat bubble a student reads on a phone, not a
 * report.
 */
export const MAX_ENGY_REPLY_CHARS = 1000;

/**
 * Phase B's system instruction. Every negative clause is load-bearing, same
 * discipline as FEEDBACK_PROMPT/ANALYSIS_PROMPT:
 *  - "inside EngMasterAI" scopes it away from being a general-purpose
 *    chatbot — the sprint brief's explicit requirement.
 *  - the conditional "when a [Context] block is present ... when it is
 *    not" clause is Phase C's addition — context now arrives per-message
 *    (see EngyChatRequest.context), not as a permanent fact about the
 *    conversation, so a static instruction has to be conditionally true
 *    for both a GENERAL message and a LESSON/VOCAB_WORD one in the same
 *    session. Trusting an attached block instead of the model's own
 *    "memory" also means it can never describe a stage it was not
 *    actually given (see chat-context.resolver.ts's allowlist).
 *  - "do not just give the final answer to a practice question the student
 *    pastes in" is a best-effort content-safety line, not a hard
 *    guarantee — the real assessment-integrity boundary is
 *    AssessmentLockService (Placement Test only), by product decision.
 */
const ENGY_SYSTEM_INSTRUCTION = [
  'You are Engy, a friendly English-learning assistant built into the EngMasterAI app for Vietnamese learners.',
  'You help with: explaining grammar points, explaining vocabulary and word meanings, explaining example sentences, giving examples, comparing similar/confusable words, correcting misunderstandings about English, simple practice exercises, and general study guidance.',
  'Some of the student\'s messages include a "[Context]" block right before their question, added by the app itself — it describes the specific lesson or word they are currently viewing. When it is present, treat it as accurate and refer to it directly. When a message has NO such block, you do not have access to that student\'s specific lesson content, progress, scores or attempt history — never claim to know or reference any of those; if asked about them, say you cannot see that information here.',
  'If a student pastes what looks like a graded quiz or test question and asks for the final answer, do not just give the answer — briefly explain the relevant rule or reasoning and let them work it out.',
  'Keep answers concise and practical. You may answer in Vietnamese or English depending on what the student used, and it is fine to mix both the way a bilingual tutor would.',
].join(' ');

interface GeminiContentPart {
  text: string;
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiContentPart[];
}

interface GeminiResponseShape {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string;
  }[];
  promptFeedback?: { blockReason?: string };
}

@Injectable()
export class GeminiEngyChatProvider implements EngyChatProvider {
  private readonly logger = new Logger(GeminiEngyChatProvider.name);

  constructor(private readonly config: ConfigService) {}

  get model(): string {
    // gemini-3.6-flash, not gemini-3.5-flash-lite (2026-09-04 incident): a
    // student reported "Couldn't send this message" in production; Google's
    // 3.5 line was returning 503 "high demand" for every model this
    // provider could plausibly use, confirmed by curling generateContent
    // directly, while 3.6-flash answered 200 every time — see
    // env.validation.ts's GEMINI_ENGY_MODEL comment for the full writeup.
    return this.config.get<string>('GEMINI_ENGY_MODEL', 'gemini-3.6-flash');
  }

  async reply(request: EngyChatRequest): Promise<EngyChatResult> {
    const apiKey = this.config.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      throw new EngyChatError(
        'NOT_CONFIGURED',
        'GEMINI_API_KEY is not set; Engy Chat is unavailable',
      );
    }

    const model = this.model;
    const timeoutMs = this.config.get<number>('CHAT_REPLY_TIMEOUT_MS', 20000);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    // The context block (if any) rides ONLY on the current turn's parts —
    // never folded into systemInstruction (which is persona, not
    // per-message data) and never written into stored/replayed history
    // (chat-session.store.ts only ever persists `request.message` itself).
    const latestTurnParts: GeminiContentPart[] = request.context
      ? [{ text: `[Context]\n${request.context}` }, { text: request.message }]
      : [{ text: request.message }];

    const contents: GeminiContent[] = [
      ...request.history.map((turn) => ({
        role: turn.role === 'assistant' ? ('model' as const) : ('user' as const),
        parts: [{ text: turn.text }],
      })),
      { role: 'user', parts: latestTurnParts },
    ];

    let response: Response;
    try {
      response = await fetch(
        `${GEMINI_ENDPOINT}/${encodeURIComponent(model)}:generateContent`,
        {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            // Header, not a query parameter: a key in a URL ends up in
            // access logs, proxy logs and error reports.
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: ENGY_SYSTEM_INSTRUCTION }] },
            contents,
            generationConfig: {
              // Low, not zero — see the file header.
              temperature: 0.4,
              maxOutputTokens: 700,
            },
          }),
        },
      );
    } catch (caught) {
      const aborted = caught instanceof Error && caught.name === 'AbortError';
      // Chat content is NEVER logged, here or anywhere — only the shape of
      // the failure is (docs/CLAUDE.md's logging policy for this feature).
      this.logger.warn(
        `Engy chat ${aborted ? 'timed out' : 'failed'} after ${timeoutMs}ms (model=${model})`,
      );
      throw new EngyChatError(
        aborted ? 'TIMEOUT' : 'UNAVAILABLE',
        aborted ? 'Engy timed out' : 'Engy is unavailable',
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      this.logger.warn(`Engy chat returned HTTP ${response.status} (model=${model})`);
      throw new EngyChatError('UNAVAILABLE', `Engy failed with status ${response.status}`);
    }

    let payload: GeminiResponseShape;
    try {
      payload = (await response.json()) as GeminiResponseShape;
    } catch {
      throw new EngyChatError('UNAVAILABLE', 'Engy returned no data');
    }

    if (payload.promptFeedback?.blockReason) {
      this.logger.warn(
        `Gemini blocked an Engy chat request: ${payload.promptFeedback.blockReason}`,
      );
      throw new EngyChatError('BLOCKED', 'The message could not be processed');
    }

    const text = payload.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? '')
      .join('')
      .trim();

    // AN EMPTY ANSWER IS A FAILURE HERE — a blank chat bubble reads as
    // broken, and reported as UNAVAILABLE so the standard retry copy
    // applies (see pronunciation-feedback/roadmap-analysis for the same rule).
    if (!text) {
      throw new EngyChatError('UNAVAILABLE', 'Engy returned an empty answer');
    }

    return { reply: truncateEngyReply(text) };
  }
}

/**
 * Bound the stored/returned reply, cutting at a sentence end where there is
 * one. Exported for tests. Same rule as truncateFeedback/truncateSummary.
 */
export const truncateEngyReply = (raw: string): string => {
  const text = raw.trim();
  if (text.length <= MAX_ENGY_REPLY_CHARS) return text;

  const cut = text.slice(0, MAX_ENGY_REPLY_CHARS);
  const lastStop = Math.max(
    cut.lastIndexOf('. '),
    cut.lastIndexOf('! '),
    cut.lastIndexOf('? '),
    cut.lastIndexOf('\n'),
  );
  if (lastStop > MAX_ENGY_REPLY_CHARS * 0.66) return cut.slice(0, lastStop + 1);
  return `${cut.trimEnd()}…`;
};
