// Redis key layout for the auth module (docs/CLAUDE.md's design record: Sprint 01A). Every key
// is namespaced under `auth:` so it's identifiable in `redis-cli KEYS`/`SCAN` without colliding
// with any future module's keys.
export const ACCESS_TOKEN_BLACKLIST_PREFIX = 'auth:atbl:';
export const REFRESH_FAMILY_PREFIX = 'auth:refresh:family:';

// Sprint 02C / ADR 006 — a per-user index over that user's live refresh
// families, alongside the existing per-family keys above. Enables
// RefreshTokenService.revokeAllForUser(), used by password reset. issue()
// SADDs, revoke() SREMs, revokeAllForUser() SMEMBERS+DEL+DEL. This SET has no
// TTL of its own (a family's own key expiring without a matching SREM just
// leaves a harmless stale member — DEL on a missing key is a no-op).
export const REFRESH_USER_INDEX_PREFIX = 'auth:refresh:user:';

// Rate-limit bucket namespace (Sprint 01C). Every bucket carries its own
// window TTL (see rate-limit-incr.lua), so there is no separate cleanup job —
// same convention as the two prefixes above.
export const RATE_LIMIT_LOGIN_COMBO_PREFIX = 'auth:rl:login:combo:';
export const RATE_LIMIT_LOGIN_IP_PREFIX = 'auth:rl:login:ip:';
export const RATE_LIMIT_REGISTER_IP_PREFIX = 'auth:rl:register:ip:';
export const RATE_LIMIT_REGISTER_COMBO_PREFIX = 'auth:rl:register:combo:';
export const RATE_LIMIT_REFRESH_FAMILY_PREFIX = 'auth:rl:refresh:family:';
export const RATE_LIMIT_REFRESH_IP_PREFIX = 'auth:rl:refresh:ip:';

// Sprint 02A. Deliberately no *_COMBO_PREFIX for plain /auth/google — an
// unverified JWT email claim is attacker-chosen, not a stable identity, so
// pre-verification limiting there is IP-only (see docs/adr/004-google-auth.md).
// /auth/google/link's combo bucket IS keyed on an identity, but only the
// backend-verified email (checked inside AuthService.linkGoogle(), not by
// the guard) — never a client-supplied claim.
export const RATE_LIMIT_GOOGLE_IP_PREFIX = 'auth:rl:google:ip:';
export const RATE_LIMIT_GOOGLE_LINK_IP_PREFIX = 'auth:rl:google:link:ip:';
export const RATE_LIMIT_GOOGLE_LINK_COMBO_PREFIX = 'auth:rl:google:link:combo:';

// Sprint 02B — email verification. Resend's user-scoped bucket is checked
// inside AuthService.resendVerification() (not the guard), same reasoning
// as RATE_LIMIT_GOOGLE_LINK_COMBO_PREFIX above.
export const RATE_LIMIT_EMAIL_VERIFY_RESEND_USER_PREFIX =
  'auth:rl:email-verify:resend:user:';
export const RATE_LIMIT_EMAIL_VERIFY_RESEND_IP_PREFIX =
  'auth:rl:email-verify:resend:ip:';
export const RATE_LIMIT_EMAIL_VERIFY_IP_PREFIX =
  'auth:rl:email-verify:verify:ip:';
export const RATE_LIMIT_EMAIL_VERIFY_TOKEN_PREFIX =
  'auth:rl:email-verify:verify:token:';

// Sprint 02C — forgot password / password reset.
export const RATE_LIMIT_PASSWORD_FORGOT_IP_PREFIX =
  'auth:rl:password:forgot:ip:';
export const RATE_LIMIT_PASSWORD_FORGOT_COMBO_PREFIX =
  'auth:rl:password:forgot:combo:';
export const RATE_LIMIT_PASSWORD_RESET_IP_PREFIX = 'auth:rl:password:reset:ip:';

export const accessTokenBlacklistKey = (tokenHash: string): string =>
  `${ACCESS_TOKEN_BLACKLIST_PREFIX}${tokenHash}`;

export const refreshFamilyKey = (familyId: string): string =>
  `${REFRESH_FAMILY_PREFIX}${familyId}`;

export const refreshUserIndexKey = (userId: string): string =>
  `${REFRESH_USER_INDEX_PREFIX}${userId}`;
