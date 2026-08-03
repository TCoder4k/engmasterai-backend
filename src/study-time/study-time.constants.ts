// Sprint 10.5 — bounds shared by the DTO and the service.
//
// Both limits are enforced at the EDGE (class-validator) so a malformed
// heartbeat is a 400 rather than a clamped write, and the service re-derives
// its own ceiling independently — the DTO bounds what may be asked for, and
// creditableSeconds bounds what may be granted.

/**
 * The client flushes once a minute; 75 leaves 15 seconds of slack for a
 * throttled timer, a backed-off retry or a tab that was briefly frozen.
 *
 * Anything larger is not a slow network, it is a client asking to be paid for
 * time it did not spend.
 */
export const MAX_FLUSH_SECONDS = 75;

/**
 * 1440 flushes at one per minute is 24 hours on a single client session.
 *
 * This is a cheap bound on session-id spam that costs no query. The client is
 * expected to rotate `clientSessionId` on reaching it rather than let its
 * heartbeats start being rejected — a tab left open for a day must not silently
 * stop being credited.
 */
export const MAX_SEQUENCE = 1440;
