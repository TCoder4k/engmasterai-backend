import { SetMetadata } from '@nestjs/common';

// Its own bucket namespace ('payment:...'), never shared with any other
// module's rate limits — same isolation reasoning as ChatRateLimitKind.
export type PaymentRateLimitKind = 'create' | 'status';

export interface PaymentRateLimitPolicy {
  kind: PaymentRateLimitKind;
  max: number;
  windowSeconds: number;
}

export const PAYMENT_RATE_LIMITS_KEY = 'payment_rate_limit';

export const PaymentRateLimit = (policy: PaymentRateLimitPolicy) =>
  SetMetadata(PAYMENT_RATE_LIMITS_KEY, policy);
