import { SetMetadata } from '@nestjs/common';

// One entry per Redis bucket a route must evaluate (Sprint 01C, §5/§6 of the
// sprint plan). Every bucket listed is checked AND incremented on every
// request to the decorated route — the guard rejects if any bucket exceeds
// its configured max. `maxConfigKey`/`windowConfigKey` name the validated
// env vars (env.validation.ts) the guard reads the actual numbers from, so
// which policies apply to a route is fully visible at the decorator site —
// never hidden behind an endpoint-name switch inside the guard.
export type RateLimitBucketKind =
  | 'login-combo'
  | 'login-ip'
  | 'register-ip'
  | 'register-combo'
  | 'refresh-family'
  | 'refresh-ip';

export interface RateLimitPolicy {
  kind: RateLimitBucketKind;
  maxConfigKey: string;
  windowConfigKey: string;
}

export const RATE_LIMITS_KEY = 'rate_limits';

export const RateLimits = (policies: RateLimitPolicy[]) =>
  SetMetadata(RATE_LIMITS_KEY, policies);
