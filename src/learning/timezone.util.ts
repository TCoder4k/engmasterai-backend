// Dependency-free (no date library — none is installed, and Sprint 04's
// constraints forbid adding packages) day-bucketing helper. Used only for
// "what calendar day is it for this user" (overdue-vs-due ordering labels,
// the daily new-word quota window, and Sprint 09's dashboard analytics) —
// never for `nextReviewAt` scheduling math itself, which stays server-UTC-
// instant-authoritative regardless of timezone (sprint plan §8/§16).
//
// SPRINT 09 CORRECTION — THIS WAS WRONG FOR EVERY NEGATIVE UTC OFFSET.
//
// The original implementation formatted `instant` to its local Y-M-D, built
// `${ymd}T00:00:00.000Z`, then subtracted "how far into the local day that
// instant reads". That subtraction assumes `${ymd}T00:00Z` lands at or AFTER
// local midnight of that same day — true east of Greenwich, false west of it.
// For America/New_York, `${ymd}T00:00Z` is still 20:00 of the PREVIOUS local
// day, so subtracting 20 hours walked a further day back:
//
//     startOfDayInTimeZone(2026-07-31T12:00Z, 'America/New_York')
//       -> 2026-07-30 00:00 local        (should be 2026-07-31 00:00)
//
// It was correct for UTC, Europe/London and Asia/Ho_Chi_Minh, which is why a
// Vietnamese userbase never surfaced it. The live consequence was in
// LearningService.getDueReviews: `introducedTodayCount` counted a ~48-hour
// window for those users, shrinking their daily new-word quota, sometimes to
// zero. Sprint 09's activity calendar is what finally made it fail a test.
//
// The correct approach measures the zone's actual UTC offset at the instant in
// question instead of inferring it from a one-sided assumption. Still correct
// across DST, for the same reason as before: the offset is read from Intl
// against a real instant, never from a fixed table.

interface ZonedWallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const WALL_CLOCK_FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();

// Intl.DateTimeFormat construction is the expensive part of this file, and the
// analytics window calls it once per day in the window. One formatter per zone,
// reused. The cache is keyed by timezone only because every option below is
// fixed.
const wallClockFormatter = (timeZone: string): Intl.DateTimeFormat => {
  const cached = WALL_CLOCK_FORMATTER_CACHE.get(timeZone);
  if (cached) return cached;

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    era: 'short',
  });
  WALL_CLOCK_FORMATTER_CACHE.set(timeZone, formatter);
  return formatter;
};

const readWallClock = (instant: Date, timeZone: string): ZonedWallClock => {
  const parts = wallClockFormatter(timeZone).formatToParts(instant);
  const get = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');

  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    // `hour12: false` yields 24 rather than 0 for midnight in some ICU
    // versions; `% 24` normalises that without affecting any other hour.
    hour: get('hour') % 24,
    minute: get('minute'),
    second: get('second'),
  };
};

// The zone's UTC offset in milliseconds at `instant`. Positive east of
// Greenwich. Derived by reading the wall clock and re-interpreting it as if it
// were UTC — the difference from the true instant IS the offset.
const offsetMsAt = (instant: Date, timeZone: string): number => {
  const wall = readWallClock(instant, timeZone);
  const wallAsUtc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
  );
  // Millisecond component is identical in both readings, so dropping it from
  // both sides leaves the offset unchanged.
  return wallAsUtc - (instant.getTime() - instant.getMilliseconds());
};

/**
 * The UTC instant at which `timeZone`'s calendar day containing `instant`
 * begins (local 00:00:00.000).
 */
export function startOfDayInTimeZone(instant: Date, timeZone: string): Date {
  const wall = readWallClock(instant, timeZone);
  const localMidnightAsUtc = Date.UTC(wall.year, wall.month - 1, wall.day);

  // First pass uses the offset in force at `instant`. That is already right
  // whenever no DST transition falls between local midnight and `instant`.
  const offsetAtInstant = offsetMsAt(instant, timeZone);
  const candidate = new Date(localMidnightAsUtc - offsetAtInstant);

  // Second pass: if the offset differs at the candidate itself, a transition
  // sits inside the day and the first pass was measured on the wrong side of
  // it. Re-solve with the offset that actually applies at midnight.
  const offsetAtCandidate = offsetMsAt(candidate, timeZone);
  if (offsetAtCandidate === offsetAtInstant) return candidate;

  return new Date(localMidnightAsUtc - offsetAtCandidate);
}
