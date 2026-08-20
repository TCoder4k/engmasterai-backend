import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { randomBytes } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { speakingLiveTicketKey } from '../speaking-redis.constants';

// Speaking Partner Live — a short-lived, single-use ticket for authenticating
// the /speaking/live WebSocket handshake.
//
// WHY NOT A JWT IN THE QUERY STRING. Browsers give a WebSocket handshake no
// custom-header story, so the access token can't travel the way every other
// authenticated call in this codebase already does
// (`ExtractJwt.fromAuthHeaderAsBearerToken()` — see jwt.strategy.ts). Putting
// the real, long-lived access JWT in a URL instead would land it in access
// logs, reverse-proxy logs and monitoring — a materially worse exposure than
// today's Bearer-header-only design. This ticket is the fix: a short-TTL,
// single-use, narrowly-scoped credential good for exactly one WS connect,
// bound to the one attempt it was issued for.
//
// ISSUED BY SpeakingAttemptService.start() (already JwtAuthGuard-protected,
// already knows userId + the new attempt.id) — no separate HTTP endpoint.
//
// CONSUMED ATOMICALLY. See lua/consume-live-ticket.lua: a GET-then-DEL
// implemented as ONE EVAL, so two connection attempts racing on the same
// ticket can never both observe it as valid — at most one ever succeeds,
// exactly the same reasoning as speaking-idempotency.store.ts's claim key,
// applied to "spend a ticket" instead of "claim a turn".

export const SPEAKING_LIVE_TICKET_TTL_SECONDS = 45;

interface LiveTicketPayload {
  userId: string;
  attemptId: string;
}

type RedisWithConsumeCommand = Redis & {
  consumeLiveTicket(key: string): Promise<string | null>;
};

@Injectable()
export class SpeakingLiveTicketStore {
  private readonly logger = new Logger(SpeakingLiveTicketStore.name);
  private readonly redis: RedisWithConsumeCommand;

  constructor(@InjectRedis() redis: Redis) {
    this.redis = redis as RedisWithConsumeCommand;

    if (typeof this.redis.consumeLiveTicket !== 'function') {
      this.redis.defineCommand('consumeLiveTicket', {
        numberOfKeys: 1,
        lua: readFileSync(join(__dirname, 'lua', 'consume-live-ticket.lua'), 'utf8'),
      });
    }
  }

  /** A fresh 32-byte random token — collision-safe without needing SET...NX. */
  async issue(userId: string, attemptId: string): Promise<string> {
    const ticket = randomBytes(32).toString('hex');
    const payload: LiveTicketPayload = { userId, attemptId };
    try {
      await this.redis.set(
        speakingLiveTicketKey(ticket),
        JSON.stringify(payload),
        'EX',
        SPEAKING_LIVE_TICKET_TTL_SECONDS,
      );
    } catch (error) {
      this.logger.error('Redis SET failed while issuing a Speaking Live ticket', error as Error);
      throw new ServiceUnavailableException('Speaking Live is temporarily unavailable');
    }
    return ticket;
  }

  /**
   * Returns the bound {userId, attemptId} exactly once, or null for a
   * missing/expired/already-used ticket. Never throws on a Redis error —
   * the gateway's only correct response to "can't verify the ticket" is
   * "reject the connection", which returning null already achieves without
   * a 503 the WS handshake has nowhere to surface anyway.
   */
  async consume(ticket: string): Promise<LiveTicketPayload | null> {
    let raw: string | null;
    try {
      raw = await this.redis.consumeLiveTicket(speakingLiveTicketKey(ticket));
    } catch (error) {
      this.logger.error('Redis EVAL failed while consuming a Speaking Live ticket', error as Error);
      return null;
    }
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw) as Partial<LiveTicketPayload>;
      if (!parsed.userId || !parsed.attemptId) return null;
      return { userId: parsed.userId, attemptId: parsed.attemptId };
    } catch {
      return null;
    }
  }
}
