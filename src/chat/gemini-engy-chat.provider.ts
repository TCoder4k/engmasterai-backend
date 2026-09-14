import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EngyChatError,
  EngyChatProvider,
  EngyChatRequest,
  EngyChatResult,
} from './engy-chat.provider';
import { DEFAULT_GEMINI_MODEL_CHAIN, parseGeminiModelList } from '../shared/gemini-models';
import {
  fetchGeminiWithFallback,
  GeminiFetchError,
  isGeminiTimeout,
} from '../shared/gemini-fetch-with-fallback';
import { consumeSseStream } from '../shared/sse-frame-reader';

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
 * The cap on what comes back, in characters — this is a chat bubble a
 * student reads on a phone, not a report.
 *
 * 2026-09-13, raised from 1000 to 1800 (real production report): a student
 * asked for an explanation of connected-speech rules (linking/reduction)
 * with multiple numbered sections and IPA examples — exactly the kind of
 * structured, multi-part answer this feature exists to give — and it was
 * getting sliced off mid-word well before finishing. 1000 was tuned against
 * pronunciation feedback's 900, which is a single paragraph of commentary on
 * one attempt, not a multi-section explanation a student explicitly asked
 * for; the two were never really comparable use cases.
 *
 * 2026-09-14, raised again from 1800 to 3000: 1800 still wasn't enough for
 * a multi-section vocabulary breakdown (literal meaning, figurative meaning,
 * common phrase, idiom — each with its own example) reported cut off mid
 * idiom. `maxOutputTokens` below was raised alongside both increases so
 * there is still real headroom left for visible text after Gemini's own
 * "thinking" tokens (see the token-budget comment there).
 */
export const MAX_ENGY_REPLY_CHARS = 3000;

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
  private readonly models: string[];

  constructor(private readonly config: ConfigService) {
    // A chain, not a single model (2026-09-05): after the 2026-09-04 outage
    // (see env.validation.ts's GEMINI_ENGY_MODEL comment), a single hardcoded
    // model is still fragile to the next transient per-model capacity blip.
    // Falls through to the next model on 429/503 — see gemini-fetch-with-fallback.ts.
    this.models = parseGeminiModelList(
      this.config.get<string>('GEMINI_ENGY_MODEL', DEFAULT_GEMINI_MODEL_CHAIN),
      'GEMINI_ENGY_MODEL',
    );
  }

  async reply(
    request: EngyChatRequest,
    onDelta: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<EngyChatResult> {
    const apiKey = this.config.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      throw new EngyChatError(
        'NOT_CONFIGURED',
        'GEMINI_API_KEY is not set; Engy Chat is unavailable',
      );
    }

    const timeoutMs = this.config.get<number>('CHAT_REPLY_TIMEOUT_MS', 20000);

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
    let model: string;
    try {
      ({ response, model } = await fetchGeminiWithFallback(
        this.models,
        timeoutMs,
        // `alt=sse` (2026-09-12): streamed generation, so the reply can be
        // relayed to the client progressively instead of only once fully
        // generated — see docs/CLAUDE.md's Engy Chat streaming note.
        (m) => `${GEMINI_ENDPOINT}/${encodeURIComponent(m)}:streamGenerateContent?alt=sse`,
        (_m, fetchSignal) => ({
          method: 'POST',
          signal: fetchSignal,
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
              // Generous, not tight (2026-09-05 incident): the 3.x model
              // chain "thinks" before answering, and thinking tokens are
              // billed against this SAME cap — a tight cap can silently
              // truncate mid-sentence well before truncateEngyReply's own
              // MAX_ENGY_REPLY_CHARS ceiling ever gets a chance to apply.
              // This is headroom for the reasoning step, not a raised
              // reply-length target. Raised 2048 -> 4096 -> 8192 alongside
              // MAX_ENGY_REPLY_CHARS's own 1000 -> 1800 -> 3000 increases:
              // observed thinking usage has run as high as ~95% of the
              // budget on a single real call, so visible-text headroom has
              // to scale with the display cap or the ALREADY-real MAX_TOKENS
              // failure path (finishReason !== 'STOP' above) starts firing
              // more often for exactly the long, structured answers these
              // raises exist to support. Confirmed well within every chain
              // model's own output limit (65536, checked directly against
              // the API 2026-09-14) — headroom here costs nothing but a
              // slightly larger response if Gemini actually uses it.
              maxOutputTokens: 8192,
            },
          }),
        }),
        this.logger,
        'engy-chat',
        signal,
      ));
    } catch (caught) {
      if (signal?.aborted) {
        // The caller (a disconnected client — see chat.controller.ts) gave
        // up; this is not a Gemini failure to log/report as one. The exact
        // message never reaches anyone — chat.service.ts's streamReply
        // checks `signal.aborted` itself and never surfaces this text.
        throw new EngyChatError('UNAVAILABLE', 'Engy chat request was cancelled');
      }
      const failedModel =
        caught instanceof GeminiFetchError ? caught.model : this.models[this.models.length - 1];
      const aborted = isGeminiTimeout(caught);
      // Chat content is NEVER logged, here or anywhere — only the shape of
      // the failure is (docs/CLAUDE.md's logging policy for this feature).
      this.logger.warn(
        `Engy chat ${aborted ? 'timed out' : 'failed'} after ${timeoutMs}ms (model=${failedModel})`,
      );
      throw new EngyChatError(
        aborted ? 'TIMEOUT' : 'UNAVAILABLE',
        aborted ? 'Engy timed out' : 'Engy is unavailable',
      );
    }

    if (!response.ok) {
      this.logger.warn(`Engy chat returned HTTP ${response.status} (model=${model})`);
      throw new EngyChatError('UNAVAILABLE', `Engy failed with status ${response.status}`);
    }
    if (!response.body) {
      throw new EngyChatError('UNAVAILABLE', 'Engy returned no data');
    }

    let fullText = '';
    let finishReason: string | undefined;
    let blockReason: string | undefined;

    try {
      await consumeSseStream(response.body, (frame) => {
        let chunk: GeminiResponseShape;
        try {
          chunk = JSON.parse(frame.data) as GeminiResponseShape;
        } catch {
          return; // a malformed/keep-alive frame — never worth aborting the whole reply over
        }

        if (chunk.promptFeedback?.blockReason) blockReason = chunk.promptFeedback.blockReason;
        const candidate = chunk.candidates?.[0];
        if (candidate?.finishReason) finishReason = candidate.finishReason;

        const deltaText = candidate?.content?.parts?.map((part) => part.text ?? '').join('') ?? '';
        if (!deltaText) return;

        // Clip BEFORE emitting, never after — a chunk that pushes fullText
        // past MAX_ENGY_REPLY_CHARS must never let the client see more than
        // the cap, even for the one chunk that crosses it (2026-09-12 review
        // finding: "emit the whole chunk, then cancel" still leaks the
        // overflow to whoever already received that write).
        const remaining = MAX_ENGY_REPLY_CHARS - fullText.length;
        if (remaining <= 0) return false;
        const clipped = deltaText.length > remaining ? deltaText.slice(0, remaining) : deltaText;
        fullText += clipped;
        if (clipped) onDelta(clipped);
        if (clipped.length < deltaText.length) return false; // hit the cap inside this very frame
      });
    } catch (caught) {
      if (signal?.aborted) throw caught; // let streamReply's signal.aborted check classify this
      this.logger.warn(`Engy chat stream read failed (model=${model})`);
      throw new EngyChatError('UNAVAILABLE', 'Engy returned no data');
    }

    if (blockReason) {
      this.logger.warn(`Gemini blocked an Engy chat request: ${blockReason}`);
      throw new EngyChatError('BLOCKED', 'The message could not be processed');
    }

    // A reply cut off mid-sentence reads as broken, not as a shorter answer
    // — reported as UNAVAILABLE so the standard retry copy applies, same as
    // an empty answer below. Skipped when WE ourselves stopped the stream at
    // MAX_ENGY_REPLY_CHARS: that is a deliberate display bound (already
    // softened by truncateEngyReply below), not the invisible-thinking-
    // tokens truncation this check exists to catch.
    //
    // 2026-09-13 fix (real production report): this used to only check
    // `finishReason === 'MAX_TOKENS'`. Under real Gemini API strain (quota
    // exhaustion on one model in the fallback chain, 503 overload on the
    // next), a stream can also end with the connection simply closing
    // early — `reader.read()` returns `done: true` — WITHOUT Gemini ever
    // sending a final chunk that carries a `finishReason` at all. That left
    // `finishReason` as `undefined`, which `=== 'MAX_TOKENS'` never matches,
    // so whatever few words had streamed in (e.g. "Tất nhiên là") were
    // returned as if they were a complete, successful answer — no error, no
    // retry prompt, just a silently truncated reply. Checking `!== 'STOP'`
    // instead catches that case (and SAFETY/RECITATION/OTHER, which were
    // equally unhandled before) alongside MAX_TOKENS, while STOP — the one
    // value that actually means "the model finished normally" — still
    // passes through untouched.
    const hitOwnCap = fullText.length >= MAX_ENGY_REPLY_CHARS;
    if (!hitOwnCap && finishReason !== 'STOP') {
      this.logger.warn(`Engy chat reply did not finish normally (finishReason=${finishReason ?? 'none'})`);
      throw new EngyChatError('UNAVAILABLE', 'Engy reply was cut off');
    }

    const text = fullText.trim();

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
