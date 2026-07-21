import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { readFileSync } from 'fs';
import { join } from 'path';

// ioredis's `defineCommand`-registered commands aren't reflected in the
// library's own types; this narrow extension covers just the one we add.
type RedisWithRateLimitCommand = Redis & {
  rateLimitIncr(key: string, windowSeconds: string): Promise<number>;
};

export interface RateLimitCheckResult {
  allowed: boolean;
  count: number;
}

/**
 * Atomic, Redis-backed fixed-window rate-limit counter (Sprint 01C).
 *
 * Wraps `rate-limit-incr.lua` (INCR + conditional EXPIRE, one EVAL round
 * trip — see the script's own comment for why this avoids the
 * GET-then-app-increment-then-SET race) exactly the way
 * `RefreshTokenService` already wraps `rotate-refresh-token.lua`: same
 * `defineCommand` registration pattern, same file layout (`src/auth/lua/`).
 *
 * Fails **closed**: a Redis error is a `ServiceUnavailableException` (503),
 * never a silently-allowed request. This introduces no new availability
 * exposure — `/auth/login`, `/auth/register`, and `/auth/refresh` already
 * hard-fail on a Redis outage today via session issuance/rotation
 * (Sprint 01A), so a fail-closed rate-limit check doesn't reduce
 * availability further, while fail-open would silently disable brute-force
 * protection during exactly the kind of infrastructure stress event most
 * likely to coincide with real abuse.
 */
@Injectable()
export class RateLimiterService {
  private readonly logger = new Logger(RateLimiterService.name);
  private readonly redis: RedisWithRateLimitCommand;

  constructor(@InjectRedis() redis: Redis) {
    this.redis = redis as RedisWithRateLimitCommand;

    if (typeof this.redis.rateLimitIncr !== 'function') {
      this.redis.defineCommand('rateLimitIncr', {
        numberOfKeys: 1,
        lua: readFileSync(
          join(__dirname, '..', 'lua', 'rate-limit-incr.lua'),
          'utf8',
        ),
      });
    }
  }

  /**
   * Increments `key`'s counter and reports whether it is still within
   * `max` for the current window. `windowSeconds` only takes effect the
   * moment the key is created (first increment) — later calls against the
   * same key never extend or reset the TTL, so the window has a fixed
   * start and end (see the Lua script's own comment).
   */
  async checkAndIncrement(
    key: string,
    max: number,
    windowSeconds: number,
  ): Promise<RateLimitCheckResult> {
    let count: number;
    try {
      count = await this.redis.rateLimitIncr(key, String(windowSeconds));
    } catch (error) {
      this.logger.error(
        'Redis EVAL failed while checking a rate-limit bucket',
        error as Error,
      );
      throw new ServiceUnavailableException(
        'Authentication service temporarily unavailable',
      );
    }

    return { allowed: count <= max, count };
  }
}
