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
  | 'refresh-ip'
  // Sprint 02A. IP-only — an unverified JWT email claim is attacker-chosen,
  // not a stable identity, so there is no google-combo/google-link-combo
  // guard-level kind; /auth/google/link's identity-keyed bucket is checked
  // separately inside AuthService.linkGoogle() against the
  // backend-verified email (see docs/adr/004-google-auth.md).
  | 'google-ip'
  | 'google-link-ip'
  // Sprint 02B. 'email-verify-resend-ip' is the only guard-level bucket for
  // resend — its user-scoped sibling is checked inside
  // AuthService.resendVerification() for the same reason
  // google-link-combo is service-level (see rate-limit-key.util.ts).
  // 'email-verify-token' bounds repeated attempts against one specific
  // verification link (token-hash-prefix keyed, never the raw token).
  | 'email-verify-resend-ip'
  | 'email-verify-ip'
  | 'email-verify-token';

export interface RateLimitPolicy {
  kind: RateLimitBucketKind;
  maxConfigKey: string;
  windowConfigKey: string;
}

export const RATE_LIMITS_KEY = 'rate_limits';

export const RateLimits = (policies: RateLimitPolicy[]) =>
  SetMetadata(RATE_LIMITS_KEY, policies);
