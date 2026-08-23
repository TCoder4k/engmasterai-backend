import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { randomBytes } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { communityLiveTicketKey } from '../community-chat-redis.constants';

// Community Chat Live — a short-lived, single-use ticket for authenticating
// the /community/live WebSocket handshake. Verbatim mirror of
// SpeakingLiveTicketStore's design (see that file's own header for the full
// "why not a JWT in the query string" rationale) — the only real difference
// is the payload: no attemptId, just {userId}, since a Community Chat
// connection isn't scoped to any one resource.
//
// ISSUED BY CommunityChatController.issueLiveTicket() (JwtAuthGuard-
// protected, already knows userId) — no separate auth path invented.
//
// CONSUMED ATOMICALLY — see lua/consume-community-ticket.lua.

export const COMMUNITY_LIVE_TICKET_TTL_SECONDS = 45;

interface CommunityLiveTicketPayload {
  userId: string;
}

type RedisWithConsumeCommand = Redis & {
  consumeCommunityTicket(key: string): Promise<string | null>;
};

@Injectable()
export class CommunityChatTicketStore {
  private readonly logger = new Logger(CommunityChatTicketStore.name);
  private readonly redis: RedisWithConsumeCommand;

  constructor(@InjectRedis() redis: Redis) {
    this.redis = redis as RedisWithConsumeCommand;

    if (typeof this.redis.consumeCommunityTicket !== 'function') {
      this.redis.defineCommand('consumeCommunityTicket', {
        numberOfKeys: 1,
        lua: readFileSync(join(__dirname, 'lua', 'consume-community-ticket.lua'), 'utf8'),
      });
    }
  }

  /** A fresh 32-byte random token — collision-safe without needing SET...NX. */
  async issue(userId: string): Promise<string> {
    const ticket = randomBytes(32).toString('hex');
    const payload: CommunityLiveTicketPayload = { userId };
    try {
      await this.redis.set(
        communityLiveTicketKey(ticket),
        JSON.stringify(payload),
        'EX',
        COMMUNITY_LIVE_TICKET_TTL_SECONDS,
      );
    } catch (error) {
      this.logger.error('Redis SET failed while issuing a Community Live ticket', error as Error);
      throw new ServiceUnavailableException('Community Chat is temporarily unavailable');
    }
    return ticket;
  }

  /**
   * Returns the bound {userId} exactly once, or null for a missing/expired/
   * already-used ticket. Never throws on a Redis error — the gateway's only
   * correct response to "can't verify the ticket" is "reject the
   * connection", which returning null already achieves without a 503 the WS
   * handshake has nowhere to surface anyway.
   */
  async consume(ticket: string): Promise<CommunityLiveTicketPayload | null> {
    let raw: string | null;
    try {
      raw = await this.redis.consumeCommunityTicket(communityLiveTicketKey(ticket));
    } catch (error) {
      this.logger.error('Redis EVAL failed while consuming a Community Live ticket', error as Error);
      return null;
    }
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw) as Partial<CommunityLiveTicketPayload>;
      if (!parsed.userId) return null;
      return { userId: parsed.userId };
    } catch {
      return null;
    }
  }
}
