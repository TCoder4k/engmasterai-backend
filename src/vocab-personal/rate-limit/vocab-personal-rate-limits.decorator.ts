import { SetMetadata } from '@nestjs/common';

// A new, fully isolated rate-limit namespace — matching how Learning,
// Dictionary and CommunityChat each got their own module-local
// decorator+guard pair rather than reusing another module's (see
// docs/CLAUDE.md's "THREE separate bucket namespaces" note, and
// dictionary-rate-limits.decorator.ts's identical reasoning). "Từ vựng của
// tôi" is its own feature domain — not the curated-deck SRS engine, not the
// quiz/lesson engine — so it gets its own bucket rather than borrowing
// `learning`'s or `quiz`'s and risking an unrelated feature's traffic
// throttling this one (the exact bug class every one of those modules'
// comments warns about).
//
// 'read' covers GET .../words and GET .../stats — both fire on every visit
// to the My Vocabulary page and every tab switch, so it needs the same
// generous headroom Learning's 'queue' bucket gives curated-deck browsing.
// 'write' covers single add/PATCH/DELETE/review — a student rating a stack
// of due words in one sitting is many small requests in a short burst, so
// this is sized like Learning's 'review' bucket, not like a rare admin edit.
// 'bulk' is its own kind, split from 'write', because ONE paste-import can
// itself contain up to 200 words (BulkCreatePersonalVocabWordsDto's own
// cap) delivered as ONE request — sharing 'write''s tighter bucket would let
// a single big import consume most of the budget a student needs for
// reviewing right afterward, and the symptom ("flashcard rating stopped
// working") would point nowhere near the import that caused it.
export type VocabPersonalRateLimitKind = 'read' | 'write' | 'bulk';

export interface VocabPersonalRateLimitPolicy {
  kind: VocabPersonalRateLimitKind;
  max: number;
  windowSeconds: number;
}

export const VOCAB_PERSONAL_RATE_LIMITS_KEY = 'vocab_personal_rate_limit';

export const VocabPersonalRateLimit = (policy: VocabPersonalRateLimitPolicy) =>
  SetMetadata(VOCAB_PERSONAL_RATE_LIMITS_KEY, policy);
