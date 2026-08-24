import {
  countCurrentStreak,
  enumerateCalendarWeekInTimeZone,
  enumerateDaysInTimeZone,
  formatDayInTimeZone,
} from './day-window';

// Pure unit tests — no Prisma, no app boot. Every case fixes an instant
// explicitly rather than reading the clock, so these cannot go red at midnight.

describe('formatDayInTimeZone', () => {
  // THE case this feature exists to get right. 17:30Z is 00:30 the NEXT day in
  // Vietnam, so a student studying at half past midnight must be credited to
  // that next day — not to the day toISOString() would report.
  it('files a UTC evening instant under the next local day for UTC+7', () => {
    const instant = new Date('2026-07-30T17:30:00.000Z');

    expect(formatDayInTimeZone(instant, 'Asia/Ho_Chi_Minh')).toBe('2026-07-31');
    expect(instant.toISOString().slice(0, 10)).toBe('2026-07-30'); // the wrong answer
  });

  it('files a UTC early-morning instant under the previous local day for UTC-4', () => {
    const instant = new Date('2026-07-31T02:00:00.000Z');

    expect(formatDayInTimeZone(instant, 'America/New_York')).toBe('2026-07-30');
  });

  it('agrees with the ISO date when the zone is UTC', () => {
    const instant = new Date('2026-07-31T12:00:00.000Z');

    expect(formatDayInTimeZone(instant, 'UTC')).toBe('2026-07-31');
  });
});

describe('enumerateDaysInTimeZone', () => {
  it('returns `count` ascending days ending on the local day of the instant', () => {
    const days = enumerateDaysInTimeZone(
      new Date('2026-07-31T03:00:00.000Z'),
      'UTC',
      7,
    );

    expect(days).toEqual([
      '2026-07-25',
      '2026-07-26',
      '2026-07-27',
      '2026-07-28',
      '2026-07-29',
      '2026-07-30',
      '2026-07-31',
    ]);
  });

  it('ends on the LOCAL day, not the UTC day', () => {
    // 17:30Z on the 30th is already the 31st in Vietnam.
    const days = enumerateDaysInTimeZone(
      new Date('2026-07-30T17:30:00.000Z'),
      'Asia/Ho_Chi_Minh',
      3,
    );

    expect(days).toEqual(['2026-07-29', '2026-07-30', '2026-07-31']);
  });

  it('crosses a month boundary without repeating or skipping a day', () => {
    const days = enumerateDaysInTimeZone(
      new Date('2026-08-02T12:00:00.000Z'),
      'UTC',
      5,
    );

    expect(days).toEqual([
      '2026-07-29',
      '2026-07-30',
      '2026-07-31',
      '2026-08-01',
      '2026-08-02',
    ]);
  });

  // The reason the walk re-anchors instead of subtracting from a day number.
  // 2026-03-08 is the US spring-forward date: that local day is 23 hours long.
  it('crosses a spring-forward DST transition with no duplicate and no gap', () => {
    const days = enumerateDaysInTimeZone(
      new Date('2026-03-10T12:00:00.000Z'),
      'America/New_York',
      5,
    );

    expect(days).toEqual([
      '2026-03-06',
      '2026-03-07',
      '2026-03-08',
      '2026-03-09',
      '2026-03-10',
    ]);
    expect(new Set(days).size).toBe(days.length);
  });

  // 2026-11-01 is the US fall-back date: that local day is 25 hours long.
  it('crosses a fall-back DST transition with no duplicate and no gap', () => {
    const days = enumerateDaysInTimeZone(
      new Date('2026-11-03T12:00:00.000Z'),
      'America/New_York',
      5,
    );

    expect(days).toEqual([
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
      '2026-11-03',
    ]);
    expect(new Set(days).size).toBe(days.length);
  });

  it('returns an empty array for a non-positive count', () => {
    expect(enumerateDaysInTimeZone(new Date(), 'UTC', 0)).toEqual([]);
    expect(enumerateDaysInTimeZone(new Date(), 'UTC', -3)).toEqual([]);
  });
});

describe('enumerateCalendarWeekInTimeZone', () => {
  const AUG_WEEK = [
    '2026-08-24',
    '2026-08-25',
    '2026-08-26',
    '2026-08-27',
    '2026-08-28',
    '2026-08-29',
    '2026-08-30',
  ];

  it('returns Monday-first when today IS Monday', () => {
    const days = enumerateCalendarWeekInTimeZone(new Date('2026-08-24T12:00:00.000Z'), 'UTC');
    expect(days).toEqual(AUG_WEEK);
  });

  // The bug this function exists to fix: enumerateDaysInTimeZone's rolling
  // window would put Monday LAST here, stranding today's checkmark on the
  // far right of the row.
  it('returns the SAME week regardless of which weekday within it is today', () => {
    const midweek = enumerateCalendarWeekInTimeZone(new Date('2026-08-26T12:00:00.000Z'), 'UTC');
    const sunday = enumerateCalendarWeekInTimeZone(new Date('2026-08-30T12:00:00.000Z'), 'UTC');
    expect(midweek).toEqual(AUG_WEEK);
    expect(sunday).toEqual(AUG_WEEK);
  });

  it('crosses a month boundary without repeating or skipping a day', () => {
    const days = enumerateCalendarWeekInTimeZone(new Date('2026-08-02T12:00:00.000Z'), 'UTC');
    expect(days).toEqual([
      '2026-07-27',
      '2026-07-28',
      '2026-07-29',
      '2026-07-30',
      '2026-07-31',
      '2026-08-01',
      '2026-08-02',
    ]);
  });

  it('crosses a spring-forward DST transition with no duplicate and no gap', () => {
    const days = enumerateCalendarWeekInTimeZone(new Date('2026-03-04T12:00:00.000Z'), 'America/New_York');
    expect(days).toEqual([
      '2026-03-02',
      '2026-03-03',
      '2026-03-04',
      '2026-03-05',
      '2026-03-06',
      '2026-03-07',
      '2026-03-08',
    ]);
    expect(new Set(days).size).toBe(7);
  });

  it('crosses a fall-back DST transition with no duplicate and no gap', () => {
    const days = enumerateCalendarWeekInTimeZone(new Date('2026-10-28T12:00:00.000Z'), 'America/New_York');
    expect(days).toEqual([
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
    ]);
    expect(new Set(days).size).toBe(7);
  });

  it('reads the LOCAL day, not the UTC day', () => {
    // 17:30Z on Monday the 24th is already Tuesday the 25th in Vietnam.
    const days = enumerateCalendarWeekInTimeZone(
      new Date('2026-08-24T17:30:00.000Z'),
      'Asia/Ho_Chi_Minh',
    );
    expect(days).toEqual(AUG_WEEK);
  });
});

describe('countCurrentStreak', () => {
  const DAYS = [
    '2026-07-25',
    '2026-07-26',
    '2026-07-27',
    '2026-07-28',
    '2026-07-29',
    '2026-07-30',
    '2026-07-31',
  ];

  it('counts back from today when today is active', () => {
    const active = new Set(['2026-07-29', '2026-07-30', '2026-07-31']);

    expect(countCurrentStreak(DAYS, active)).toBe(3);
  });

  // The product rule: an evening learner must not see 0 every morning.
  it('does NOT break the streak when today is empty but yesterday is active', () => {
    const active = new Set(['2026-07-29', '2026-07-30']);

    expect(countCurrentStreak(DAYS, active)).toBe(2);
  });

  it('breaks once a whole day has passed with nothing in it', () => {
    // Yesterday empty too — the run ended before it.
    const active = new Set(['2026-07-27', '2026-07-28']);

    expect(countCurrentStreak(DAYS, active)).toBe(0);
  });

  it('ignores active days that sit before a gap', () => {
    const active = new Set(['2026-07-25', '2026-07-26', '2026-07-31']);

    expect(countCurrentStreak(DAYS, active)).toBe(1);
  });

  it('returns the full window when every day is active', () => {
    expect(countCurrentStreak(DAYS, new Set(DAYS))).toBe(DAYS.length);
  });

  it('returns 0 for no activity at all', () => {
    expect(countCurrentStreak(DAYS, new Set())).toBe(0);
  });

  it('returns 0 for an empty window', () => {
    expect(countCurrentStreak([], new Set(['2026-07-31']))).toBe(0);
  });

  // Guards the startIndex arithmetic: with one day, an inactive today makes
  // startIndex -1, which must not read days[-1].
  it('handles a single-day window', () => {
    expect(countCurrentStreak(['2026-07-31'], new Set(['2026-07-31']))).toBe(1);
    expect(countCurrentStreak(['2026-07-31'], new Set())).toBe(0);
  });
});
