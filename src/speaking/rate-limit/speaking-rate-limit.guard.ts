import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { RateLimiterService } from '../../auth/rate-limit/rate-limiter.service';
import { RateLimitExceededException } from '../../auth/exceptions/rate-limit-exceeded.exception';
import { SPEAKING_RATE_LIMITS_KEY, SpeakingRateLimitPolicy } from './speaking-rate-limits.decorator';

interface RequestWithUser extends Request {
  user?: { userId: string };
}

// Mirrors ChatRateLimitGuard/DictionaryRateLimitGuard verbatim — module-local
// rate-limit guards are this codebase's convention rather than one shared
// implementation.
@Injectable()
export class SpeakingRateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const policy = this.reflector.get<SpeakingRateLimitPolicy | undefined>(
      SPEAKING_RATE_LIMITS_KEY,
      context.getHandler(),
    );
    if (!policy) return true;

    const req = context.switchToHttp().getRequest<RequestWithUser>();
    const userId = req.user?.userId;
    // JwtAuthGuard always runs first on every route this guard is attached
    // to; this is a defensive fallthrough, not a real bypass path.
    if (!userId) return true;

    const key = `speaking:${policy.kind}:${userId}`;
    const result = await this.rateLimiter.checkAndIncrement(key, policy.max, policy.windowSeconds);
    if (!result.allowed) {
      throw new RateLimitExceededException();
    }
    return true;
  }
}
