// Redis key layout for the auth module (docs/CLAUDE.md's design record: Sprint 01A). Every key
// is namespaced under `auth:` so it's identifiable in `redis-cli KEYS`/`SCAN` without colliding
// with any future module's keys.
export const ACCESS_TOKEN_BLACKLIST_PREFIX = 'auth:atbl:';
export const REFRESH_FAMILY_PREFIX = 'auth:refresh:family:';

// Rate-limit bucket namespace (Sprint 01C). Every bucket carries its own
// window TTL (see rate-limit-incr.lua), so there is no separate cleanup job —
// same convention as the two prefixes above.
export const RATE_LIMIT_LOGIN_COMBO_PREFIX = 'auth:rl:login:combo:';
export const RATE_LIMIT_LOGIN_IP_PREFIX = 'auth:rl:login:ip:';
export const RATE_LIMIT_REGISTER_IP_PREFIX = 'auth:rl:register:ip:';
export const RATE_LIMIT_REGISTER_COMBO_PREFIX = 'auth:rl:register:combo:';
export const RATE_LIMIT_REFRESH_FAMILY_PREFIX = 'auth:rl:refresh:family:';
export const RATE_LIMIT_REFRESH_IP_PREFIX = 'auth:rl:refresh:ip:';

export const accessTokenBlacklistKey = (tokenHash: string): string =>
  `${ACCESS_TOKEN_BLACKLIST_PREFIX}${tokenHash}`;

export const refreshFamilyKey = (familyId: string): string =>
  `${REFRESH_FAMILY_PREFIX}${familyId}`;
