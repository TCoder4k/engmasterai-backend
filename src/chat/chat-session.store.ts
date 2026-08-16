import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'fs';
import { join } from 'path';
import { chatSessionKey, MAX_CHAT_TURNS } from './chat-redis.constants';
import { ChatSessionSnapshot, StoredChatTurn } from './chat.types';

// ioredis's `defineCommand`-registered commands aren't reflected in the
// library's own types; this narrow extension covers just the one we add —
// same convention as RateLimiterService/RefreshTokenService.
type RedisWithAppendCommand = Redis & {
  appendChatTurn(
    key: string,
    userText: string,
    assistantText: string,
    nowMs: string,
    maxTurns: string,
    ttlSeconds: string,
  ): Promise<'OK'>;
};

interface StoredSessionRecord {
  turns: StoredChatTurn[];
}

/**
 * Bounded, Redis-only chat history (Phase B — no Prisma model, no
 * migration). One key per user (`chat:session:<userId>`), sliding TTL
 * refreshed on every append.
 *
 * FAILS CLOSED, unlike DictionaryCacheStore: a dictionary cache miss just
 * costs one extra external lookup, but losing chat history silently would
 * mean Engy "forgets" mid-conversation without the student or the server
 * ever knowing something went wrong. A Redis error here is always a 503.
 */
@Injectable()
export class ChatSessionStore {
  private readonly logger = new Logger(ChatSessionStore.name);
  private readonly redis: RedisWithAppendCommand;

  constructor(
    @InjectRedis() redis: Redis,
    private readonly config: ConfigService,
  ) {
    this.redis = redis as RedisWithAppendCommand;

    if (typeof this.redis.appendChatTurn !== 'function') {
      this.redis.defineCommand('appendChatTurn', {
        numberOfKeys: 1,
        lua: readFileSync(join(__dirname, 'lua', 'append-chat-turn.lua'), 'utf8'),
      });
    }
  }

  get ttlSeconds(): number {
    return this.config.get<number>('CHAT_SESSION_TTL_SECONDS', 1800);
  }

  /** Turns only — used to build the Gemini request's history, oldest-first. */
  async getTurns(userId: string): Promise<StoredChatTurn[]> {
    let raw: string | null;
    try {
      raw = await this.redis.get(chatSessionKey(userId));
    } catch (error) {
      this.logger.error('Redis read failed while loading a chat session', error as Error);
      throw new ServiceUnavailableException('Chat is temporarily unavailable');
    }
    if (!raw) return [];
    return parseRecord(raw).turns;
  }

  /** Full snapshot (turns + expiry) — backs GET /chat/session. */
  async getSnapshot(userId: string): Promise<ChatSessionSnapshot> {
    const key = chatSessionKey(userId);
    let raw: string | null;
    let ttl: number;
    try {
      [raw, ttl] = await Promise.all([this.redis.get(key), this.redis.ttl(key)]);
    } catch (error) {
      this.logger.error('Redis read failed while loading a chat session', error as Error);
      throw new ServiceUnavailableException('Chat is temporarily unavailable');
    }
    if (!raw) return { turns: [], expiresAt: null };
    return {
      turns: parseRecord(raw).turns,
      expiresAt: ttl > 0 ? new Date(Date.now() + ttl * 1000).toISOString() : null,
    };
  }

  /**
   * Atomically appends one user+assistant pair — see
   * lua/append-chat-turn.lua for why this must be a single EVAL rather than
   * a GET-modify-SET from Node (two different messages for the same user
   * arriving concurrently would otherwise be able to lose one another's turn).
   */
  async appendTurn(userId: string, userText: string, assistantText: string): Promise<void> {
    try {
      await this.redis.appendChatTurn(
        chatSessionKey(userId),
        userText,
        assistantText,
        String(Date.now()),
        String(MAX_CHAT_TURNS),
        String(this.ttlSeconds),
      );
    } catch (error) {
      this.logger.error('Redis EVAL failed while appending a chat turn', error as Error);
      throw new ServiceUnavailableException('Chat is temporarily unavailable');
    }
  }

  /** Idempotent — a missing key is a no-op, matching RefreshTokenService.revoke(). */
  async clear(userId: string): Promise<void> {
    try {
      await this.redis.del(chatSessionKey(userId));
    } catch (error) {
      this.logger.error('Redis delete failed while clearing a chat session', error as Error);
      throw new ServiceUnavailableException('Chat is temporarily unavailable');
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
