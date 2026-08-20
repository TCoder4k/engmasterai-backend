import { SetMetadata } from '@nestjs/common';

// Speaking Partner's own rate-limit namespace, mirroring
// ChatRateLimitKind's pattern (see docs/CLAUDE.md's "THREE separate bucket
// namespaces" note, since extended by Dictionary/Chat's own further ones) —
// the kind IS the bucket, and Speaking must never share one with any other
// module's.
//
// `translate` guards the optional, on-demand subtitle-translation call —
// separate from `start`/`complete` (cheap DB-only reads/writes) and
// `manage` (admin authoring, no paid call), the same reasoning that keeps
// `speech` and `aiFeedback` apart in ListeningModule.
//
// `live-connect` replaced the old `turn` kind. The conversation itself
// moved to Gemini Live over a WebSocket (src/speaking/live/) — there is no
// more per-turn HTTP request to rate-limit, so the guard now caps NEW
// connections per window instead of individual turns within one. Applied
// directly inside SpeakingLiveGateway.handleConnection (not via
// @SpeakingRateLimit/SpeakingRateLimitGuard — a gateway's
// handleConnection is a lifecycle hook, not a route handler NestJS guards
// can wrap), but the key namespace (`speaking:live-connect:<userId>`)
// still follows this same `speaking:<kind>:<userId>` convention.
export type SpeakingRateLimitKind = 'read' | 'start' | 'complete' | 'manage' | 'translate' | 'live-connect';

export interface SpeakingRateLimitPolicy {
  kind: SpeakingRateLimitKind;
  max: number;
  windowSeconds: number;
}

export const SPEAKING_RATE_LIMITS_KEY = 'speaking_rate_limit';

export const SpeakingRateLimit = (policy: SpeakingRateLimitPolicy) =>
  SetMetadata(SPEAKING_RATE_LIMITS_KEY, policy);
