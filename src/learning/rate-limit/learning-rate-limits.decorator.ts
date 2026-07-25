import { SetMetadata } from '@nestjs/common';

// Sprint 04 — deliberately not a reuse of src/auth/decorators/rate-limits.decorator.ts's
// @RateLimits(): that decorator's RateLimitBucketKind union and
// key-extraction logic (email/familyId/token from the request body/
// cookies) are hardwired to auth flows. This is a much smaller, generic
// single-policy decorator keyed on userId — see LearningRateLimitGuard.
export type LearningRateLimitKind = 'review' | 'queue';

export interface LearningRateLimitPolicy {
  kind: LearningRateLimitKind;
  max: number;
  windowSeconds: number;
}

export const LEARNING_RATE_LIMITS_KEY = 'learning_rate_limit';

export const LearningRateLimit = (policy: LearningRateLimitPolicy) =>
  SetMetadata(LEARNING_RATE_LIMITS_KEY, policy);
