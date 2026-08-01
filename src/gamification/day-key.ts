import { formatDayInTimeZone } from '../analytics/day-window';

// Sprint 10 — the ONLY way an instant becomes a UserDailyActivity.day value.
// Pure: no Prisma, no clock of its own.
//
// WHY THIS FILE EXISTS AT ALL, for a two-line conversion.
//
// UserDailyActivity.day is `@db.Date`, and Prisma sends a JS Date for it,
// which Postgres truncates IN UTC. So the Date handed over must be UTC
// midnight of the LOCAL day — not the local midnight instant, and certainly
// not `new Date(someIsoDate)` on a raw timestamp.
//
// Getting this wrong is not hypothetical. Sprint 09 found startOfDayInTimeZone
// had been a full day out for every negative UTC offset since Sprint 04,
// silently shrinking the SRS new-word quota for those users the whole time. It
// was one arithmetic assumption in one helper with no spec. This is the same
// shape of conversion, so it gets its own helper and its own spec rather than
// being inlined at each call site where nobody would ever look at it again.
//
// The day BOUNDARY logic is not reimplemented here — formatDayInTimeZone
// (src/analytics/day-window.ts) already owns "what calendar day is this
// instant in, in this zone", and is spec'd across positive, negative,
// half-hour and DST-transition zones. This adds only the storage encoding.

/**
 * `'YYYY-MM-DD'` -> the Date that Postgres will store as exactly that DATE.
 *
 * Built from the string's parts through `Date.UTC`, never `new Date(dayKey)`.
 * The two happen to agree for a bare `'2026-07-31'` today, but `new Date` on a
 * date-like string is a parsing rule rather than an arithmetic one, and it is
 * the habit — not this one call — that produced the Sprint 09 bug.
 *
 * @throws if the input is not a bare calendar day; a malformed key would
 *   otherwise become an Invalid Date and land in the database as NULL or a
 *   silently wrong row.
 */
export const dayKeyToDate = (dayKey: string): Date => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!match) {
    throw new RangeError(`Not a YYYY-MM-DD day key: ${dayKey}`);
  }
  const [, year, month, day] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
};

/**
 * The calendar day `instant` falls on in `timeZone`, encoded for storage.
 *
 * This is the composition every caller actually wants, exposed so no call site
 * has to remember that the two steps belong together.
 */
export const activityDayFor = (instant: Date, timeZone: string): Date =>
  dayKeyToDate(formatDayInTimeZone(instant, timeZone));

/**
 * Do two instants fall on the same calendar day in `timeZone`?
 *
 * The hot-path guard. LessonStepService's video transaction already has the
 * previous `lastActivityAt` in hand, and a 10-minute lesson posts ~86 progress
 * reports; if the stored one is already on today's date, the activity row for
 * today must already exist and the upsert can be skipped entirely. Compares
 * day KEYS rather than timestamps, because "same day" is a timezone question,
 * not a subtraction.
 */
export const isSameActivityDay = (
  a: Date,
  b: Date,
  timeZone: string,
): boolean =>
  formatDayInTimeZone(a, timeZone) === formatDayInTimeZone(b, timeZone);
