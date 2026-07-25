// Dependency-free (no date library — none is installed, and Sprint 04's
// constraints forbid adding packages) day-bucketing helper. Used only for
// "what calendar day is it for this user" (overdue-vs-due ordering labels,
// the daily new-word quota window) — never for `nextReviewAt` scheduling
// math itself, which stays server-UTC-instant-authoritative regardless of
// timezone (sprint plan §8/§16).
//
// Algorithm: format `instant` in `timeZone` to get its calendar Y-M-D, then
// find the UTC instant that reads as that Y-M-D's 00:00:00 wall-clock time
// in `timeZone`. Correct across DST because the offset is measured via
// Intl against the actual instant in question, not assumed from a fixed
// UTC offset table.
export function startOfDayInTimeZone(instant: Date, timeZone: string): Date {
  const dateFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const ymd = dateFormatter.format(instant); // "YYYY-MM-DD"

  let guess = new Date(`${ymd}T00:00:00.000Z`);

  const timeFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = timeFormatter.formatToParts(guess);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const msIntoDay = ((get('hour') % 24) * 3600 + get('minute') * 60 + get('second')) * 1000;

  guess = new Date(guess.getTime() - msIntoDay);
  return guess;
}
