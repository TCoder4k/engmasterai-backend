import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { accessTokenBlacklistKey } from './auth-redis.constants';
import { sha256Hex } from './utils/hash.util';
import { AuthEventLogger } from './logging/auth-event-logger.service';

/**
 * Access-token blacklist (Redis-backed).
 *
 * Replaces the previous in-memory `Map` implementation, which was lost on
 * restart and not shared across instances. Only a SHA-256 hash of the token
 * is ever stored — never the raw JWT (which embeds the user's email) — and
 * Redis's own `EX` handles expiry, so there is no manual cleanup timer to
 * maintain.
 *
 * A Redis connection failure is a service outage, not "token is fine": both
 * methods throw `ServiceUnavailableException` (503) rather than silently
 * treating an unverifiable token as clean (fail-open) or as invalid (401,
 * which would incorrectly imply the token itself is bad).
 */
@Injectable()
export class TokenBlacklistService {
  private readonly logger = new Logger(TokenBlacklistService.name);

  constructor(
    @InjectRedis() private readonly redis: Redis,
    private readonly authEventLogger: AuthEventLogger,
  ) {}

  /**
   * Adds a token to the blacklist for the remainder of its natural lifetime.
   * @param token - JWT access token to revoke
   * @param expiresAt - the token's `exp` claim (Unix timestamp, seconds)
   */
  async addToBlacklist(token: string, expiresAt: number): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const ttl = expiresAt - now;

    // Already expired — nothing to revoke, and Redis rejects a non-positive EX.
    if (ttl <= 0) return;

    try {
      await this.redis.set(
        accessTokenBlacklistKey(sha256Hex(token)),
        '1',
        'EX',
        ttl,
      );
    } catch (error) {
      this.logger.error(
        'Redis write failed while blacklisting an access token',
        error as Error,
      );
      this.authEventLogger.log('auth.redis.unavailable', {
        route: 'POST /auth/logout',
        failureCategory: 'access_token_blacklist_write_failed',
      });
      throw new ServiceUnavailableException(
        'Authentication service temporarily unavailable',
      );
    }
  }

  async isBlacklisted(token: string): Promise<boolean> {
    try {
      const value = await this.redis.get(
        accessTokenBlacklistKey(sha256Hex(token)),
      );
      return value !== null;
    } catch (error) {
      this.logger.error(
        'Redis read failed while checking the access-token blacklist',
        error as Error,
      );
      this.authEventLogger.log('auth.redis.unavailable', {
        failureCategory: 'access_token_blacklist_read_failed',
      });
      throw new ServiceUnavailableException(
        'Authentication service temporarily unavailable',
      );
    }
  }
}
