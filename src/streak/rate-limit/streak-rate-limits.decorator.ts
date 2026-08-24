import { SetMetadata } from '@nestjs/common';

// Streak's own independent rate-limit namespace — must never share a bucket
// with community:/notification:/chat:/etc.
export type StreakRateLimitKind = 'invite' | 'respond' | 'read' | 'share';

export interface StreakRateLimitPolicy {
  kind: StreakRateLimitKind;
  max: number;
  windowSeconds: number;
}

export const STREAK_RATE_LIMITS_KEY = 'streak_rate_limit';

export const StreakRateLimit = (policy: StreakRateLimitPolicy) =>
  SetMetadata(STREAK_RATE_LIMITS_KEY, policy);
