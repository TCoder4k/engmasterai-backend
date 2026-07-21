// Redis key layout for the auth module (docs/CLAUDE.md's design record: Sprint 01A). Every key
// is namespaced under `auth:` so it's identifiable in `redis-cli KEYS`/`SCAN` without colliding
// with any future module's keys.
export const ACCESS_TOKEN_BLACKLIST_PREFIX = 'auth:atbl:';
export const REFRESH_FAMILY_PREFIX = 'auth:refresh:family:';

export const accessTokenBlacklistKey = (tokenHash: string): string =>
  `${ACCESS_TOKEN_BLACKLIST_PREFIX}${tokenHash}`;

export const refreshFamilyKey = (familyId: string): string =>
  `${REFRESH_FAMILY_PREFIX}${familyId}`;
