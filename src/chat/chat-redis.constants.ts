// Same key-prefix-constant + builder-function convention as
// dictionary-redis.constants.ts / auth-redis.constants.ts.

export const CHAT_SESSION_PREFIX = 'chat:session:';
export const CHAT_CLAIM_PREFIX = 'chat:claim:';

export const chatSessionKey = (userId: string): string => `${CHAT_SESSION_PREFIX}${userId}`;

/** Per-message idempotency claim — see chat-idempotency.store.ts's header comment. */
export const chatClaimKey = (userId: string, clientMessageId: string): string =>
  `${CHAT_CLAIM_PREFIX}${userId}:${clientMessageId}`;

// 12 stored turns = 6 user/assistant exchanges, the previously-approved
// bound (docs/CLAUDE.md's Phase B plan). Oldest pair dropped first once
// exceeded — see lua/append-chat-turn.lua.
export const MAX_CHAT_TURNS = 12;
