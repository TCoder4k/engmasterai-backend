import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AssessmentLockService } from './assessment-lock.service';
import { ChatContextResolver } from './chat-context.resolver';
import { ChatIdempotencyStore } from './chat-idempotency.store';
import { ChatSessionStore } from './chat-session.store';
import { ENGY_CHAT_PROVIDER, EngyChatError } from './engy-chat.provider';
import type { EngyChatProvider } from './engy-chat.provider';
import { ChatReplyInProgressException } from './chat.exceptions';
import { ChatContextInput } from './chat-context.types';
import { ChatSessionSnapshot, SendChatMessageResult } from './chat.types';

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
   * Placement lock -> context resolution -> idempotency claim -> (owner
   * only) Gemini -> commit + append. See chat-idempotency.store.ts's header
   * comment for the full race analysis; this method is deliberately just
   * the orchestration, not where any of that reasoning lives.
   *
   * Context is resolved BEFORE the idempotency claim, same "fail fast on
   * the cheapest check first" ordering as the placement lock — a bad/
   * unauthorized resourceId 404s without ever touching the claim store or
   * Gemini, on a replay exactly as much as on a first attempt.
   */
  async sendMessage(
    userId: string,
    clientMessageId: string,
    message: string,
    context: ChatContextInput,
  ): Promise<SendChatMessageResult> {
    // Independent of the frontend's route-structure exclusion — never trust
    // the client. See assessment-lock.service.ts's header comment.
    await this.assessmentLock.assertNotInPlacementAttempt(userId);

    const contextText = await this.contextResolver.resolve(context);

    const claim = await this.idempotency.claim(userId, clientMessageId, this.pendingClaimTtlSeconds());
    if (claim.outcome === 'done') {
      return { clientMessageId, reply: claim.reply, repliedAt: claim.repliedAt };
    }
    if (claim.outcome === 'conflict') {
      throw new ChatReplyInProgressException();
    }

    // outcome === 'claimed' — this call is the sole owner of clientMessageId.
    const history = await this.sessionStore.getTurns(userId);

    let reply: string;
    try {
      const result = await this.provider.reply({
        history: history.map((turn) => ({ role: turn.role, text: turn.text })),
        message,
        context: contextText,
      });
      reply = result.reply;
    } catch (error) {
      // Release the claim so a legitimate retry with the SAME
      // clientMessageId is not stuck behind its own abandoned claim.
      await this.idempotency.release(userId, clientMessageId);
      if (error instanceof EngyChatError) {
        this.logger.warn(
          `Engy reply failed (kind=${error.kind}, model=${this.provider.model}, userId=${userId})`,
        );
        throw new ServiceUnavailableException('Engy is temporarily unavailable');
      }
      throw error;
    }

    const repliedAt = new Date().toISOString();
    await this.idempotency.commit(
      userId,
      clientMessageId,
      reply,
      repliedAt,
      this.sessionStore.ttlSeconds,
    );
    await this.sessionStore.appendTurn(userId, message, reply);

    return { clientMessageId, reply, repliedAt };
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
