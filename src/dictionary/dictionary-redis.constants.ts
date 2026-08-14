// Redis key layout for the Dictionary module. Namespaced under `dictionary:`
// so it's identifiable in `redis-cli KEYS`/`SCAN` without colliding with any
// other module's keys — same convention as auth-redis.constants.ts.
export const DICTIONARY_CACHE_PREFIX = 'dictionary:cache:';

export const dictionaryCacheKey = (normalizedWord: string): string =>
  `${DICTIONARY_CACHE_PREFIX}${normalizedWord}`;
