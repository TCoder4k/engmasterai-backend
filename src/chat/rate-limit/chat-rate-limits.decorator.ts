import { SetMetadata } from '@nestjs/common';

// A fifth, independent rate-limit namespace (see docs/CLAUDE.md's "THREE
// separate bucket namespaces" note, since extended by Dictionary's own
// fourth) — Engy must never share a bucket with speech/aiFeedback/
// placementAnalysis/dictionary lookups/dictionary suggestions. It is an
// optional chatbot; it must never be able to consume quota reserved for
// core learning functionality, and vice versa.
export type ChatRateLimitKind = 'message';

export interface ChatRateLimitPolicy {
  kind: ChatRateLimitKind;
  max: number;
  windowSeconds: number;
}

export const CHAT_RATE_LIMITS_KEY = 'chat_rate_limit';

export const ChatRateLimit = (policy: ChatRateLimitPolicy) =>
  SetMetadata(CHAT_RATE_LIMITS_KEY, policy);
