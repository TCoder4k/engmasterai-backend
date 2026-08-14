import { SetMetadata } from '@nestjs/common';

// A fourth, independent rate-limit namespace — matching how Learning and
// VocabDeck each got their own rather than reusing QuizRateLimitGuard's
// (see docs/CLAUDE.md's "THREE separate bucket namespaces" note). Dictionary
// lookups are not the SRS/quiz engine and must never share a bucket with it.
export type DictionaryRateLimitKind = 'lookup' | 'suggest';

export interface DictionaryRateLimitPolicy {
  kind: DictionaryRateLimitKind;
  max: number;
  windowSeconds: number;
}

export const DICTIONARY_RATE_LIMITS_KEY = 'dictionary_rate_limit';

export const DictionaryRateLimit = (policy: DictionaryRateLimitPolicy) =>
  SetMetadata(DICTIONARY_RATE_LIMITS_KEY, policy);
