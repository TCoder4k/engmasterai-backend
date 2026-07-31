import { startOfDayInTimeZone } from '../learning/timezone.util';

// Sprint 09 — pure calendar-day helpers for the dashboard analytics window.
// No Prisma, no I/O, no clock of its own: every function takes the instant it
// should treat as "now". That is what makes the day-boundary behaviour — the
// single most bug-prone part of this feature — testable without freezing time.
//
// Built on the existing startOfDayInTimeZone (src/learning/timezone.util.ts)
// rather than a second implementation of the same Intl dance. That helper is
// dependency-free by design (no date library is installed, and Sprint 04's
// constraints forbid adding one); these functions inherit that property.
//
// DEBT: timezone.util.ts lives under src/learning/ but now has two consumers
// in two domains. Moving it to src/shared/ is a cleanup-sprint job — a pure
// function imported across module folders creates no DI coupling, so there is
// nothing broken to fix today, only a name that has outgrown its folder.

/**
 * The calendar day `instant` falls on, in `timeZone`, as 'YYYY-MM-DD'.
 *
 * This is the ONLY way an instant is turned into a day key in this feature.
 * `toISOString().slice(0, 10)` is not equivalent and is the bug this exists to
 * prevent: for a UTC+7 student, 2026-07-30T17:30:00Z is 00:30 on the 31st
 * locally, and the ISO form would file a full day of early-morning study under
 * yesterday.
 */
export const formatDayInTimeZone = (instant: Date, timeZone: string): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);

/**
 * `count` consecutive calendar days in `timeZone`, ASCENDING, ending on the day
 * `endInstant` falls on.
 *
 * Walks backwards from the start of the end day in 24-hour steps and re-reads
 * the calendar day of each result rather than doing arithmetic on Y-M-D. That
 * matters across a DST transition: one such step can land at 23:00 or 01:00 of
 * the neighbouring day, and only asking the timezone what day that instant is
 * gives the right answer. Subtracting 1 from a day-of-month would silently
 * produce a duplicate or a gap twice a year.
 */
export const enumerateDaysInTimeZone = (
  endInstant: Date,
  timeZone: string,
  count: number,
): string[] => {
  if (count <= 0) return [];

  const days: string[] = [];
  let cursor = startOfDayInTimeZone(endInstant, timeZone);

  for (let index = 0; index < count; index += 1) {
    days.push(formatDayInTimeZone(cursor, timeZone));
    // Step back 12 hours from the START of the current day, then re-anchor.
    //
    // 12 is chosen to land solidly in the middle of the previous day and can
    // never overshoot it: the largest DST shift is one hour, so midnight minus
    // 12h is 11:00-13:00 of the day before, whether that day was 23, 24 or 25
    // hours long. A full 24h step would sit exactly on a boundary and land on
    // the wrong side of a fall-back; anything over 24h skips a day outright.
    cursor = startOfDayInTimeZone(
      new Date(cursor.getTime() - 12 * 60 * 60 * 1000),
      timeZone,
    );
  }

  return days.reverse();
};

/**
 * How many consecutive days, counting back from the END of `days`, are present
 * in `activeDays`.
 *
 * THE RULE, which is a product decision and not an obvious one: if the last day
 * (today) has no activity but the one before it does, the streak counts from
 * that previous day and is NOT yet broken. A student who studies every evening
 * must not watch their streak read 0 every morning — the streak breaks only
 * once a whole day has passed with nothing in it.
 *
 * `days` must be ascending and end with today, as enumerateDaysInTimeZone
 * returns it.
 */
export const countCurrentStreak = (
  days: string[],
  activeDays: ReadonlySet<string>,
): number => {
  if (days.length === 0) return 0;

  // Today not being active costs nothing yet; start counting from yesterday.
  const startIndex = activeDays.has(days[days.length - 1])
    ? days.length - 1
    : days.length - 2;

  let streak = 0;
  for (let index = startIndex; index >= 0; index -= 1) {
    if (!activeDays.has(days[index])) break;
    streak += 1;
  }
  return streak;
};
