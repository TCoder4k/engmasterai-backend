import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';
import { randomBytes, randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { refreshFamilyKey, refreshUserIndexKey } from './auth-redis.constants';
import { sha256Hex } from './utils/hash.util';
import { DEFAULT_REFRESH_TOKEN_TTL_SECONDS } from './refresh-token.constants';
import { AuthEventLogger } from './logging/auth-event-logger.service';

interface RefreshSessionRecord {
  userId: string;
  currentSecretHash: string;
  createdAt: number;
  lastUsedAt: number;
  userAgent: string | null;
}

export type RotateOutcome = 'ok' | 'missing' | 'reused';

export interface IssuedRefreshToken {
  familyId: string;
  secret: string;
}

export interface RotateResult {
  outcome: RotateOutcome;
  secret?: string;
  userId?: string;
}

const COOKIE_SEPARATOR = '.';

// ioredis's `defineCommand`-registered commands aren't reflected in the
// library's own types; this narrow extension covers just the one we add.
// The Lua script returns a 2-element array: [outcome, userId] (userId is
// "" when outcome is "missing", since there's no record to read it from).
type RedisWithRotateCommand = Redis & {
  rotateRefreshToken(
    key: string,
    presentedHash: string,
    newHash: string,
    nowMs: string,
    ttlSeconds: string,
  ): Promise<[RotateOutcome, string]>;
};

/**
 * Opaque, rotating refresh-token sessions ("families"), Redis-backed.
 *
 * Strict single-use rotation (Sprint 01A, no grace window — see
 * `lua/rotate-refresh-token.lua`): a family's current secret may be redeemed
 * exactly once. Presenting anything else — including the secret that was
 * just rotated away — revokes the whole family. Only a hash of the secret
 * is ever persisted; the plaintext only ever exists in memory long enough
 * to be handed back to the caller for cookie-setting.
 */
@Injectable()
export class RefreshTokenService {
  private readonly logger = new Logger(RefreshTokenService.name);
  private readonly redis: RedisWithRotateCommand;
  private readonly ttlSeconds: number;

  constructor(
    @InjectRedis() redis: Redis,
    private readonly config: ConfigService,
    private readonly authEventLogger: AuthEventLogger,
  ) {
    this.redis = redis as RedisWithRotateCommand;
    this.ttlSeconds = Number(
      this.config.get<string>(
        'REFRESH_TOKEN_TTL_SECONDS',
        String(DEFAULT_REFRESH_TOKEN_TTL_SECONDS),
      ),
    );

    // Registered once per process against the shared connection; ioredis
    // caches the script server-side (EVALSHA) after the first call.
    if (typeof this.redis.rotateRefreshToken !== 'function') {
      this.redis.defineCommand('rotateRefreshToken', {
        numberOfKeys: 1,
        lua: readFileSync(
          join(__dirname, 'lua', 'rotate-refresh-token.lua'),
          'utf8',
        ),
      });
    }
  }

  private generateSecret(): string {
    return randomBytes(32).toString('base64url');
  }

  /** `<familyId>.<secret>` — the literal refresh-cookie value. */
  encodeCookieValue(familyId: string, secret: string): string {
    return `${familyId}${COOKIE_SEPARATOR}${secret}`;
  }

  parseCookieValue(
    cookieValue: string | undefined | null,
  ): { familyId: string; secret: string } | null {
    if (!cookieValue) return null;
    const separatorIndex = cookieValue.indexOf(COOKIE_SEPARATOR);
    if (separatorIndex <= 0 || separatorIndex === cookieValue.length - 1)
      return null;
    const familyId = cookieValue.slice(0, separatorIndex);
    const secret = cookieValue.slice(separatorIndex + 1);
    return { familyId, secret };
  }

  /** Creates a new session family — called on login/register. */
  async issue(
    userId: string,
    userAgent: string | null,
  ): Promise<IssuedRefreshToken> {
    const familyId = randomUUID();
    const secret = this.generateSecret();
    const record: RefreshSessionRecord = {
      userId,
      currentSecretHash: sha256Hex(secret),
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      userAgent,
    };

    try {
      await this.redis.set(
        refreshFamilyKey(familyId),
        JSON.stringify(record),
        'EX',
        this.ttlSeconds,
      );
      // ADR 006: keep the per-user index in sync so a later password reset
      // can revoke every family this user has live, not just one.
      await this.redis.sadd(refreshUserIndexKey(userId), familyId);
    } catch (error) {
      this.logger.error(
        'Redis write failed while issuing a refresh session',
        error as Error,
      );
      this.authEventLogger.log('auth.redis.unavailable', {
        route: 'POST /auth/login|register',
        failureCategory: 'refresh_session_issue_failed',
      });
      throw new ServiceUnavailableException(
        'Authentication service temporarily unavailable',
      );
    }

    return { familyId, secret };
  }

  /**
   * Atomically validates + rotates a presented secret against its family.
   * See `lua/rotate-refresh-token.lua` for the exact compare-and-swap logic.
   */
  async rotate(
    familyId: string,
    presentedSecret: string,
  ): Promise<RotateResult> {
    const newSecret = this.generateSecret();

    let outcome: RotateOutcome;
    let userId: string;
    try {
      [outcome, userId] = await this.redis.rotateRefreshToken(
        refreshFamilyKey(familyId),
        sha256Hex(presentedSecret),
        sha256Hex(newSecret),
        String(Date.now()),
        String(this.ttlSeconds),
      );
    } catch (error) {
      this.logger.error(
        'Redis EVAL failed while rotating a refresh token',
        error as Error,
      );
      this.authEventLogger.log('auth.redis.unavailable', {
        route: 'POST /auth/refresh',
        failureCategory: 'refresh_token_rotate_failed',
      });
      throw new ServiceUnavailableException(
        'Authentication service temporarily unavailable',
      );
    }

    if (outcome === 'reused') {
      this.logger.warn(
        `Refresh-token reuse detected; family revoked (familyId=${familyId}, userId=${userId})`,
      );
    }

    return outcome === 'ok'
      ? { outcome, secret: newSecret, userId }
      : { outcome, userId: userId || undefined };
  }

  /** Deletes a family outright — used by logout. Idempotent (a missing key is a no-op). */
  async revoke(familyId: string): Promise<void> {
    try {
      // Read first so the per-user index (ADR 006) can be kept in sync too —
      // the record is the only place that names which user this family
      // belongs to. A missing/unparsable record just skips the SREM; the
      // DEL below is still attempted and is itself a no-op if already gone.
      const raw = await this.redis.get(refreshFamilyKey(familyId));
      const pipeline = this.redis.pipeline();
      pipeline.del(refreshFamilyKey(familyId));
      if (raw) {
        const { userId } = JSON.parse(raw) as RefreshSessionRecord;
        pipeline.srem(refreshUserIndexKey(userId), familyId);
      }
      await pipeline.exec();
    } catch (error) {
      this.logger.error(
        'Redis delete failed while revoking a refresh family',
        error as Error,
      );
      this.authEventLogger.log('auth.redis.unavailable', {
        route: 'POST /auth/logout',
        failureCategory: 'refresh_token_revoke_failed',
      });
      throw new ServiceUnavailableException(
        'Authentication service temporarily unavailable',
      );
    }
  }

  /**
   * Revokes every refresh-token family belonging to a user in one call — the
   * "log out of every device" primitive (ADR 006), used by password reset.
   * Not reused by logout() itself, which only ever revokes the one family
   * tied to its own request cookie.
   *
   * Throws `ServiceUnavailableException` on Redis failure, same fail-closed
   * convention as every other method here. Callers for whom a fully
   * completed, unrelated action (e.g. a password change already committed to
   * Postgres) must not be undone by this failure are expected to catch it
   * explicitly and degrade to a logged, alert-worthy event rather than
   * propagating a 503 — see `AuthService.resetPassword()` and ADR 006's
   * documented residual risk.
   */
  async revokeAllForUser(userId: string): Promise<void> {
    try {
      const familyIds = await this.redis.smembers(refreshUserIndexKey(userId));
      if (familyIds.length > 0) {
        const pipeline = this.redis.pipeline();
        for (const familyId of familyIds) {
          pipeline.del(refreshFamilyKey(familyId));
        }
        await pipeline.exec();
      }
      await this.redis.del(refreshUserIndexKey(userId));
    } catch (error) {
      this.logger.error(
        'Redis operation failed while revoking every refresh session for a user',
        error as Error,
      );
      this.authEventLogger.log('auth.redis.unavailable', {
        route: 'POST /auth/password/reset',
        failureCategory: 'refresh_token_revoke_all_failed',
      });
      throw new ServiceUnavailableException(
        'Authentication service temporarily unavailable',
      );
    }
  }
}
