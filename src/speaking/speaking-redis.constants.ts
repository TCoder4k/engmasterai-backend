// Speaking Partner — same key-prefix-constant + builder-function convention
// as chat-redis.constants.ts, own namespace.

export const SPEAKING_SESSION_PREFIX = 'speaking:session:';
export const SPEAKING_CLAIM_PREFIX = 'speaking:claim:';
export const SPEAKING_LIVE_TICKET_PREFIX = 'speaking:live-ticket:';

export const speakingSessionKey = (userId: string, attemptId: string): string =>
  `${SPEAKING_SESSION_PREFIX}${userId}:${attemptId}`;

/** One single-use WS-connect ticket — see speaking-live-ticket.store.ts. */
export const speakingLiveTicketKey = (ticket: string): string =>
  `${SPEAKING_LIVE_TICKET_PREFIX}${ticket}`;

/** Per-turn idempotency claim — see speaking-idempotency.store.ts's header comment. */
export const speakingClaimKey = (
  userId: string,
  attemptId: string,
  clientTurnId: string,
): string => `${SPEAKING_CLAIM_PREFIX}${userId}:${attemptId}:${clientTurnId}`;

// 24 stored turns = 12 user/assistant exchanges. Oldest pair dropped first
// once exceeded — see lua/append-speaking-turn.lua.
export const MAX_SPEAKING_TURNS = 24;
