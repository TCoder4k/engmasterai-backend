import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AssessmentLockService } from './assessment-lock.service';
import { ChatContextResolver } from './chat-context.resolver';
import { ChatIdempotencyStore } from './chat-idempotency.store';
import { ChatSessionStore } from './chat-session.store';
import { ENGY_CHAT_PROVIDER, EngyChatError, EngyChatHistoryTurn } from './engy-chat.provider';
import type { EngyChatProvider } from './engy-chat.provider';
import { ChatReplyInProgressException } from './chat.exceptions';
import { ChatContextInput } from './chat-context.types';
import { ChatSessionSnapshot, SendChatMessageResult } from './chat.types';

/** `prepareSend`'s result — see its own doc comment for why this is split from `streamReply`. */
export type PreparedChatSend =
  | { kind: 'replay'; result: SendChatMessageResult }
  | { kind: 'claimed'; contextText: string | null; history: EngyChatHistoryTurn[] };

export type StreamReplyOutcome =
  | { kind: 'done'; result: SendChatMessageResult }
  | { kind: 'error' }
  /** The client disconnected before this finished — nothing was committed, nothing to send back. */
  | { kind: 'aborted' };

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly assessmentLock: AssessmentLockService,
    private readonly contextResolver: ChatContextResolver,
    private readonly sessionStore: ChatSessionStore,
    private readonly idempotency: ChatIdempotencyStore,
    @Inject(ENGY_CHAT_PROVIDER) private readonly provider: EngyChatProvider,
    private readonly config: ConfigService,
  ) {}

  /**
   * PHASE 1 of Engy Chat's send flow (2026-09-12, streaming rewrite) —
   * everything that is allowed to throw a normal HttpException, because the
   * controller has not yet switched the response into SSE mode when this
   * runs. Placement lock -> context resolution -> idempotency claim, same
   * "fail fast on the cheapest check first" ordering as before the split
   * (context resolved BEFORE the claim: a bad/unauthorized resourceId 404s
   * without ever touching the claim store or Gemini, on a replay exactly as
   * much as on a first attempt). See chat-idempotency.store.ts's header
   * comment for the claim race analysis.
   *
   * `outcome === 'done'` (an idempotent replay) is NOT an error — the
   * controller sends the already-known reply as a single SSE `done` event,
   * no second Gemini call. `outcome === 'conflict'` still throws exactly as
   * before (a genuine concurrent duplicate).
   */
  async prepareSend(
    userId: string,
    clientMessageId: string,
    message: string,
    context: ChatContextInput,
  ): Promise<PreparedChatSend> {
    // Independent of the frontend's route-structure exclusion — never trust
    // the client. See assessment-lock.service.ts's header comment.
    await this.assessmentLock.assertNotInPlacementAttempt(userId);

    const contextText = await this.contextResolver.resolve(context);

    const claim = await this.idempotency.claim(userId, clientMessageId, this.pendingClaimTtlSeconds());
    if (claim.outcome === 'done') {
      return { kind: 'replay', result: { clientMessageId, reply: claim.reply, repliedAt: claim.repliedAt } };
    }
    if (claim.outcome === 'conflict') {
      throw new ChatReplyInProgressException();
    }

    // outcome === 'claimed' — this call is the sole owner of clientMessageId.
    const history = await this.sessionStore.getTurns(userId);
    return {
      kind: 'claimed',
      contextText,
      history: history.map((turn) => ({ role: turn.role, text: turn.text })),
    };
  }

  /**
   * PHASE 2 — only reached for `prepareSend`'s `'claimed'` outcome, i.e. only
   * once the controller has already committed to writing an SSE response.
   * Failures are reported as an OUTCOME, never thrown: by this point there
   * is no way back to a normal JSON error response (see chat.controller.ts).
   *
   * `opts.signal` fires when the client's HTTP connection closes before this
   * settles (see chat.controller.ts's `res.on('close', ...)`) — threaded all
   * the way to `fetchGeminiWithFallback` so a disconnect actually cancels
   * the in-flight Gemini call rather than letting it run to completion
   * unread. `idempotency.release()` runs on EVERY failure path, abort
   * included, so a legitimate retry is never stuck behind an abandoned claim.
   */
  async streamReply(
    userId: string,
    clientMessageId: string,
    message: string,
    contextText: string | null,
    history: EngyChatHistoryTurn[],
    opts: { signal: AbortSignal; onDelta: (text: string) => void },
  ): Promise<StreamReplyOutcome> {
    try {
      const result = await this.provider.reply(
        { history, message, context: contextText },
        opts.onDelta,
        opts.signal,
      );
      const repliedAt = new Date().toISOString();
      await this.idempotency.commit(
        userId,
        clientMessageId,
        result.reply,
        repliedAt,
        this.sessionStore.ttlSeconds,
      );
      await this.sessionStore.appendTurn(userId, message, result.reply);
      return { kind: 'done', result: { clientMessageId, reply: result.reply, repliedAt } };
    } catch (error) {
      // Release the claim so a legitimate retry with the SAME
      // clientMessageId is not stuck behind its own abandoned claim —
      // whether this failed for real or was cancelled by a disconnect.
      await this.idempotency.release(userId, clientMessageId);
      if (opts.signal.aborted) return { kind: 'aborted' };
      if (error instanceof EngyChatError) {
        // Which model failed is already logged, per attempt, inside the
        // provider itself (see gemini-fetch-with-fallback.ts) — a chain can
        // try several models per request, so there is no single "the model"
        // to name here.
        this.logger.warn(`Engy reply failed (kind=${error.kind}, userId=${userId})`);
        return { kind: 'error' };
      }
      throw error;
    }
  }

  async getSession(userId: string): Promise<ChatSessionSnapshot> {
    return this.sessionStore.getSnapshot(userId);
  }

  async clearSession(userId: string): Promise<void> {
    await this.sessionStore.clear(userId);
  }

  /**
   * Comfortably longer than the Gemini call itself (buffer for the
   * claim-poller's own latency), short enough that a crashed/killed owner
   * self-heals in about a minute rather than blocking a legitimate retry
   * for the whole session TTL.
   */
  private pendingClaimTtlSeconds(): number {
    const timeoutMs = this.config.get<number>('CHAT_REPLY_TIMEOUT_MS', 20000);
    return Math.ceil(timeoutMs / 1000) + 60;
  }
}
