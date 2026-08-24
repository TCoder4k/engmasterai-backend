import { dayKeyToDate } from '../gamification/day-key';

// A pure function imported across module folders — no DI coupling, same
// precedent day-window.ts/day-key.ts already set for being shared this way
// (see day-window.ts's own "DEBT" comment). Reuses dayKeyToDate rather than
// re-parsing 'YYYY-MM-DD' strings a second way.

/**
 * Whole calendar days between two 'YYYY-MM-DD' labels (`to` - `from`).
 * Positive when `to` is later. Used only to compare two ALREADY-COMPUTED
 * day labels — never to derive a label from an instant (that stays
 * formatDayInTimeZone's job).
 */
export const daysBetweenLabels = (from: string, to: string): number =>
  Math.round((dayKeyToDate(to).getTime() - dayKeyToDate(from).getTime()) / 86_400_000);

/**
 * Sort two user ids into a stable (low, high) pair. Arbitrary ordering
 * (plain string comparison over UUIDs) — the only requirement is that it
 * is the SAME ordering every time, so A-inviting-B and B-inviting-A can
 * never create two StreakPair rows for the same pair.
 */
export const canonicalPair = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a]);
