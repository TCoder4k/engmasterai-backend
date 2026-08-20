import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'fs';
import { join } from 'path';
import { MAX_SPEAKING_TURNS, speakingSessionKey } from './speaking-redis.constants';
import { StoredSpeakingTurn } from './speaking.types';

// ioredis's `defineCommand`-registered commands aren't reflected in the
// library's own types; this narrow extension covers just the one we add —
// same convention as ChatSessionStore/RateLimiterService/RefreshTokenService.
type RedisWithAppendCommand = Redis & {
  appendSpeakingTurn(
    key: string,
    userText: string,
    assistantText: string,
    nowMs: string,
    maxTurns: string,
    ttlSeconds: string,
  ): Promise<'OK'>;
};

interface StoredSessionRecord {
  turns: StoredSpeakingTurn[];
}

/**
 * Bounded, Redis-only conversation history for one attempt (Phase 1+2 — no
 * Prisma model, no migration for the turn text itself). One key per
 * (userId, attemptId), sliding TTL refreshed on every append. Copy of
 * chat-session.store.ts's exact mechanism, keyed per-attempt instead of
 * per-user.
 *
 * THIS IS THE AUTHORITATIVE TURN HISTORY for the whole life of the
 * conversation — SpeakingAttempt.turnCount is derived from it exactly once,
 * at complete(), never incremented per turn (see
 * SpeakingAttemptService.complete()).
 *
 * FAILS CLOSED: a Redis error here is always a 503, never a silently-skipped
 * history — losing conversation context mid-session would mean the AI
 * partner "forgets" without the student or the server ever knowing something
 * went wrong.
 */
@Injectable()
export class SpeakingSessionStore {
  private readonly logger = new Logger(SpeakingSessionStore.name);
  private readonly redis: RedisWithAppendCommand;

  constructor(
    @InjectRedis() redis: Redis,
    private readonly config: ConfigService,
  ) {
    this.redis = redis as RedisWithAppendCommand;

    if (typeof this.redis.appendSpeakingTurn !== 'function') {
      this.redis.defineCommand('appendSpeakingTurn', {
        numberOfKeys: 1,
        lua: readFileSync(join(__dirname, 'lua', 'append-speaking-turn.lua'), 'utf8'),
      });
    }
  }

  get ttlSeconds(): number {
    return this.config.get<number>('SPEAKING_SESSION_TTL_SECONDS', 1800);
  }

  /** Turns only — used to build the AI request's history, oldest-first. */
  async getTurns(userId: string, attemptId: string): Promise<StoredSpeakingTurn[]> {
    let raw: string | null;
    try {
      raw = await this.redis.get(speakingSessionKey(userId, attemptId));
    } catch (error) {
      this.logger.error('Redis read failed while loading a speaking session', error as Error);
      throw new ServiceUnavailableException('Speaking practice is temporarily unavailable');
    }
    if (!raw) return [];
    return parseRecord(raw).turns;
  }

  /**
   * Atomically appends one user+assistant pair. See
   * lua/append-speaking-turn.lua for why this must be a single EVAL rather
   * than a GET-modify-SET from Node.
   */
  async appendTurn(userId: string, attemptId: string, userText: string, assistantText: string): Promise<void> {
    try {
      await this.redis.appendSpeakingTurn(
        speakingSessionKey(userId, attemptId),
        userText,
        assistantText,
        String(Date.now()),
        String(MAX_SPEAKING_TURNS),
        String(this.ttlSeconds),
      );
    } catch (error) {
      this.logger.error('Redis EVAL failed while appending a speaking turn', error as Error);
      throw new ServiceUnavailableException('Speaking practice is temporarily unavailable');
    }
  }

  /**
   * Idempotent — a missing key is a no-op, matching ChatSessionStore.clear().
   * Called from complete(): the conversation is over, so there is no reason
   * to wait out the TTL.
   */
  async clear(userId: string, attemptId: string): Promise<void> {
    try {
      await this.redis.del(speakingSessionKey(userId, attemptId));
    } catch (error) {
      this.logger.error('Redis delete failed while clearing a speaking session', error as Error);
      throw new ServiceUnavailableException('Speaking practice is temporarily unavailable');
    }
  }
}

const parseRecord = (raw: string): StoredSessionRecord => {
  try {
    const parsed = JSON.parse(raw) as Partial<StoredSessionRecord>;
    return { turns: Array.isArray(parsed.turns) ? parsed.turns : [] };
  } catch {
    return { turns: [] };
  }
};
