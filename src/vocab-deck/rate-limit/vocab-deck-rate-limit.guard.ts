import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { RateLimiterService } from '../../auth/rate-limit/rate-limiter.service';
import { RateLimitExceededException } from '../../auth/exceptions/rate-limit-exceeded.exception';
import {
  VOCAB_DECK_RATE_LIMITS_KEY,
  VocabDeckRateLimitPolicy,
} from './vocab-deck-rate-limits.decorator';

interface RequestWithUser extends Request {
  user?: { userId: string };
}

// Mirrors LearningRateLimitGuard verbatim (same generic
// Redis-Lua-backed counter via RateLimiterService.checkAndIncrement),
// deliberately re-declared per module rather than shared — see that
// guard's own comment for why module-local rate-limit guards are this
// codebase's convention.
@Injectable()
export class VocabDeckRateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const policy = this.reflector.get<VocabDeckRateLimitPolicy | undefined>(
      VOCAB_DECK_RATE_LIMITS_KEY,
      context.getHandler(),
    );
    if (!policy) return true;

    const req = context.switchToHttp().getRequest<RequestWithUser>();
    const userId = req.user?.userId;
    // JwtAuthGuard always runs first on every route this guard is attached
    // to and rejects an unauthenticated request before this guard ever sees
    // it; this is not a real bypass path, just a defensive fallthrough.
    if (!userId) return true;

    const key = `vocabDeck:${policy.kind}:${userId}`;
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
