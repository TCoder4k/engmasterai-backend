import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { RateLimiterService } from '../../auth/rate-limit/rate-limiter.service';
import { RateLimitExceededException } from '../../auth/exceptions/rate-limit-exceeded.exception';
import {
  LEARNING_RATE_LIMITS_KEY,
  LearningRateLimitPolicy,
} from './learning-rate-limits.decorator';

interface RequestWithUser extends Request {
  user?: { userId: string };
}

/**
 * Evaluates the single `@LearningRateLimit(...)` policy attached to the
 * current route, keyed on the authenticated user's id (this is always an
 * authenticated action — see JwtAuthGuard, which runs first in every
 * route's guard list). Reuses RateLimiterService.checkAndIncrement
 * directly — the same generic Redis-Lua-backed counter
 * AuthRateLimitGuard uses, with none of that guard's auth-specific
 * key-extraction machinery (sprint plan §19).
 */
@Injectable()
export class LearningRateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const policy = this.reflector.get<LearningRateLimitPolicy | undefined>(
      LEARNING_RATE_LIMITS_KEY,
      context.getHandler(),
    );
    if (!policy) return true;

    const req = context.switchToHttp().getRequest<RequestWithUser>();
    const userId = req.user?.userId;
    // JwtAuthGuard always runs first in this module's routes and rejects an
    // unauthenticated request before this guard ever sees it; this is not a
    // real bypass path, just a defensive fallthrough.
    if (!userId) return true;

    const key = `learning:${policy.kind}:${userId}`;
    const result = await this.rateLimiter.checkAndIncrement(
      key,
      policy.max,
      policy.windowSeconds,
    );
    if (!result.allowed) {
      throw new RateLimitExceededException();
    }
    return true;
  }
}
