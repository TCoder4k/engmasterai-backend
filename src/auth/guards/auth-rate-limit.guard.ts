import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import {
  RATE_LIMITS_KEY,
  RateLimitBucketKind,
  RateLimitPolicy,
} from '../decorators/rate-limits.decorator';
import { RateLimiterService } from '../rate-limit/rate-limiter.service';
import { RefreshTokenService } from '../refresh-token.service';
import { REFRESH_COOKIE_NAME } from '../refresh-token.constants';
import { RateLimitExceededException } from '../exceptions/rate-limit-exceeded.exception';
import { hashClientIp } from '../utils/client-ip.util';
import {
  emailHashPrefix,
  googleIpKey,
  googleLinkIpKey,
  loginComboKey,
  loginIpKey,
  refreshFamilyRateLimitKey,
  refreshIpKey,
  registerComboKey,
  registerIpKey,
} from '../rate-limit/rate-limit-key.util';
import { AuthEventLogger } from '../logging/auth-event-logger.service';
import type { RequestWithId } from '../logging/request-id.middleware';

/**
 * Evaluates every `@RateLimits([...])` policy attached to the current
 * route (Sprint 01C, Task 2). Every applicable bucket is incremented on
 * every request — a request blocked by one bucket still counts against the
 * others, so it can't be used to keep a different bucket "clean". Throws
 * `RateLimitExceededException` (429) the moment any bucket is over its max;
 * buckets after that point are simply not checked (short-circuits — no
 * behavioral difference, since the request is rejected regardless of what
 * the remaining buckets would have said).
 */
@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimiter: RateLimiterService,
    private readonly config: ConfigService,
    private readonly refreshTokenService: RefreshTokenService,
    private readonly authEventLogger: AuthEventLogger,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const policies = this.reflector.get<RateLimitPolicy[] | undefined>(
      RATE_LIMITS_KEY,
      context.getHandler(),
    );
    if (!policies || policies.length === 0) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const ipHash = hashClientIp(req);
    const email = this.extractEmail(req);
    const familyId = this.extractFamilyId(req);

    for (const policy of policies) {
      const key = this.buildKey(policy.kind, { ipHash, email, familyId });
      // A bucket with no derivable key for this request (e.g. a
      // login-combo policy with no email in the body) simply doesn't apply
      // to this request — the other policies still do.
      if (key === null) continue;

      // Always defined — env.validation.ts's Joi schema guarantees a
      // default/validated value for every *ConfigKey named in a policy.
      const max = this.config.get<number>(policy.maxConfigKey) as number;
      const windowSeconds = this.config.get<number>(
        policy.windowConfigKey,
      ) as number;
      const result = await this.rateLimiter.checkAndIncrement(
        key,
        max,
        windowSeconds,
      );

      if (!result.allowed) {
        this.authEventLogger.log('auth.rate_limit.exceeded', {
          requestId: (req as RequestWithId).requestId,
          route: `${req.method} ${(req.route as { path?: string } | undefined)?.path ?? req.path}`,
          ipHash,
          emailHash: email ? emailHashPrefix(email) : undefined,
          familyIdTruncated: familyId?.slice(0, 8),
          failureCategory: policy.kind,
        });
        throw new RateLimitExceededException();
      }
    }

    return true;
  }

  private extractEmail(req: Request): string | undefined {
    const body = req.body as Record<string, unknown> | undefined;
    const email = body?.email;
    return typeof email === 'string' && email.length > 0 ? email : undefined;
  }

  private extractFamilyId(req: Request): string | undefined {
    const cookies = req.cookies as
      | Record<string, string | undefined>
      | undefined;
    const parsed = this.refreshTokenService.parseCookieValue(
      cookies?.[REFRESH_COOKIE_NAME],
    );
    return parsed?.familyId;
  }

  private buildKey(
    kind: RateLimitBucketKind,
    ctx: { ipHash: string; email?: string; familyId?: string },
  ): string | null {
    switch (kind) {
      case 'login-combo':
        return ctx.email
          ? loginComboKey(ctx.ipHash, emailHashPrefix(ctx.email))
          : null;
      case 'login-ip':
        return loginIpKey(ctx.ipHash);
      case 'register-ip':
        return registerIpKey(ctx.ipHash);
      case 'register-combo':
        return ctx.email
          ? registerComboKey(ctx.ipHash, emailHashPrefix(ctx.email))
          : null;
      case 'refresh-family':
        return ctx.familyId ? refreshFamilyRateLimitKey(ctx.familyId) : null;
      case 'refresh-ip':
        return refreshIpKey(ctx.ipHash);
      case 'google-ip':
        return googleIpKey(ctx.ipHash);
      case 'google-link-ip':
        return googleLinkIpKey(ctx.ipHash);
    }
  }
}
