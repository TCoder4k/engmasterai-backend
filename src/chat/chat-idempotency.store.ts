import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { chatClaimKey } from './chat-redis.constants';

/**
 * Per-`clientMessageId` idempotency, Redis-only (Phase B).
 *
 * WHY NOT "GET Redis -> check id -> call Gemini -> SET Redis": that has a
 * race window between the GET and the SET where two requests for the same
 * clientMessageId (a network retry racing the original, a double-click that
 * slipped past the frontend's own guard) can both observe "no reply yet"
 * and both call Gemini — a duplicate PAID call, exactly what this store
 * exists to prevent.
 *
 * MECHANISM — a claim key, `SET key '{"status":"pending"}' NX EX <ttl>`:
 * `SET ... NX` is already atomic in Redis (one round trip, no separate
 * check-then-set), so at most ONE caller ever wins the claim for a given
 * (userId, clientMessageId) pair. The winner calls Gemini and then
 * overwrites the key with the final `{status:'done', reply, repliedAt}`
 * (commit()). Everyone else — genuinely concurrent duplicates — polls the
 * same key briefly: if it resolves to 'done' within the poll budget, they
 * return that cached reply (Gemini called exactly once); if it is still
 * 'pending' once the budget is spent, they get a 409 (ChatReplyInProgress)
 * rather than either duplicating the call or blocking indefinitely. A LATER
 * replay (same clientMessageId, sent after the first request already
 * finished) hits 'done' on its very first read — no polling needed.
 *
 * No Lua script needed here: `SET NX EX` is a single already-atomic Redis
 * command, so there is no read-modify-write race to close with a script —
 * unlike the session store's append, which genuinely does a
 * read-modify-write and therefore does need one (see
 * lua/append-chat-turn.lua).
 *
 * FAILS CLOSED: any Redis error while claiming/polling is a 503, never a
 * silently-skipped idempotency check.
 */
export const CLAIM_POLL_ATTEMPTS = 5;
export const CLAIM_POLL_INTERVAL_MS = 200;

export type ChatClaimResult =
  | { outcome: 'claimed' }
  | { outcome: 'done'; reply: string; repliedAt: string }
  | { outcome: 'conflict' };

type ClaimValue = { status: 'pending' } | { status: 'done'; reply: string; repliedAt: string };

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

@Injectable()
export class ChatIdempotencyStore {
  private readonly logger = new Logger(ChatIdempotencyStore.name);

  constructor(@InjectRedis() private readonly redis: Redis) {}

  async claim(
    userId: string,
    clientMessageId: string,
    pendingTtlSeconds: number,
  ): Promise<ChatClaimResult> {
    const key = chatClaimKey(userId, clientMessageId);

    let setResult: string | null;
    try {
      setResult = await this.redis.set(
        key,
        JSON.stringify({ status: 'pending' } satisfies ClaimValue),
        'EX',
        pendingTtlSeconds,
        'NX',
      );
    } catch (error) {
      this.logger.error('Redis SET NX failed while claiming a chat message', error as Error);
      throw new ServiceUnavailableException('Chat is temporarily unavailable');
    }
    if (setResult === 'OK') return { outcome: 'claimed' };

    // Someone else already owns this clientMessageId. Poll briefly rather
    // than firing a second, paid Gemini call or blocking indefinitely.
    for (let attempt = 0; attempt < CLAIM_POLL_ATTEMPTS; attempt += 1) {
      await sleep(CLAIM_POLL_INTERVAL_MS);

      let raw: string | null;
      try {
        raw = await this.redis.get(key);
      } catch (error) {
        this.logger.error('Redis GET failed while polling a chat claim', error as Error);
        throw new ServiceUnavailableException('Chat is temporarily unavailable');
      }
      if (!raw) break; // the claim vanished (released/expired) — fall through to conflict

      const parsed = JSON.parse(raw) as ClaimValue;
      if (parsed.status === 'done') {
        return { outcome: 'done', reply: parsed.reply, repliedAt: parsed.repliedAt };
      }
    }

    return { outcome: 'conflict' };
  }

  /** Called by the claim's owner once Gemini has actually replied. */
  async commit(
    userId: string,
    clientMessageId: string,
    reply: string,
    repliedAt: string,
    doneTtlSeconds: number,
  ): Promise<void> {
    try {
      await this.redis.set(
        chatClaimKey(userId, clientMessageId),
        JSON.stringify({ status: 'done', reply, repliedAt } satisfies ClaimValue),
        'EX',
        doneTtlSeconds,
      );
    } catch (error) {
      this.logger.error('Redis SET failed while committing a chat reply', error as Error);
      throw new ServiceUnavailableException('Chat is temporarily unavailable');
    }
  }

  /**
   * Releases a claim after the owner failed to get a reply (Gemini error) —
   * without this, a legitimate retry with the SAME clientMessageId would be
   * permanently stuck behind its own abandoned 'pending' claim until the
   * pending TTL expires. Best-effort: this runs inside an already-failing
   * path, so a Redis error here is logged, not thrown — the ORIGINAL
   * Gemini failure is what the caller must see, not a masking 503.
   */
  async release(userId: string, clientMessageId: string): Promise<void> {
    try {
      await this.redis.del(chatClaimKey(userId, clientMessageId));
    } catch (error) {
      this.logger.warn(
        `Redis DEL failed while releasing a chat claim (userId=${userId}) — it will self-expire via its pending TTL`,
        error as Error,
      );
    }
  }
}
