import { SetMetadata } from '@nestjs/common';

// Community Chat's own independent rate-limit namespace (see docs/CLAUDE.md's
// "THREE separate bucket namespaces" note, since extended by every module
// that followed) — must never share a bucket with chat:/speaking:/etc.
//
// `live-connect` is included here purely for key-namespace documentation,
// same as SpeakingRateLimitKind does for its own — it is applied manually
// inside CommunityChatGateway.handleConnection, not via
// @CommunityChatRateLimit/CommunityChatRateLimitGuard, because a gateway's
// handleConnection is a lifecycle hook, not a route handler NestJS guards
// can wrap.
export type CommunityChatRateLimitKind = 'send' | 'read' | 'live-connect';

export interface CommunityChatRateLimitPolicy {
  kind: CommunityChatRateLimitKind;
  max: number;
  windowSeconds: number;
}

export const COMMUNITY_CHAT_RATE_LIMITS_KEY = 'community_chat_rate_limit';

export const CommunityChatRateLimit = (policy: CommunityChatRateLimitPolicy) =>
  SetMetadata(COMMUNITY_CHAT_RATE_LIMITS_KEY, policy);
