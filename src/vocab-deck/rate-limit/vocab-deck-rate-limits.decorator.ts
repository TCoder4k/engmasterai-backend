import { SetMetadata } from '@nestjs/common';

// Same small, generic single-policy shape as
// src/learning/rate-limit/learning-rate-limits.decorator.ts, deliberately
// not shared with it — Guess-the-Word progress is NOT the SRS engine (see
// VocabGuessProgress in schema.prisma), and giving it its own kinds keeps
// its traffic from ever starving (or being starved by) the real
// review/queue buckets, matching this codebase's "the kind IS the bucket"
// convention. Two kinds, not one: the guard keys its Redis counter on
// `kind` alone (see VocabDeckRateLimitGuard), so every route sharing a kind
// MUST declare the identical max/windowSeconds — 'guessProgress' (read +
// mark-learned, generous) and 'guessProgressReset' (the destructive
// whole-deck reset, kept separately tight) exist as two kinds precisely
// because those two call shapes need different limits.
export type VocabDeckRateLimitKind = 'guessProgress' | 'guessProgressReset';

export interface VocabDeckRateLimitPolicy {
  kind: VocabDeckRateLimitKind;
  max: number;
  windowSeconds: number;
}

export const VOCAB_DECK_RATE_LIMITS_KEY = 'vocab_deck_rate_limit';

export const VocabDeckRateLimit = (policy: VocabDeckRateLimitPolicy) =>
  SetMetadata(VOCAB_DECK_RATE_LIMITS_KEY, policy);
