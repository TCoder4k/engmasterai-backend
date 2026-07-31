import { startOfDayInTimeZone } from './timezone.util';

// Sprint 09 — the first spec this helper has ever had. It was added because the
// original implementation was a full day out for every NEGATIVE UTC offset (see
// the file header), a bug that shipped in Sprint 04 and survived because every
// consumer and every user sat at UTC+7.
//
// Each case asserts the local wall-clock reading of the result, not a raw UTC
// string: "the returned instant IS local midnight of the right day" is the
// property that matters, and asserting it in local terms is what makes these
// tests readable when they fail.

const localReading = (instant: Date, timeZone: string): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(instant);

describe('startOfDayInTimeZone', () => {
  describe('positive UTC offsets (the case that always worked)', () => {
    it('resolves local midnight for Asia/Ho_Chi_Minh', () => {
      const result = startOfDayInTimeZone(
        new Date('2026-07-31T12:00:00.000Z'),
        'Asia/Ho_Chi_Minh',
      );

      expect(localReading(result, 'Asia/Ho_Chi_Minh')).toBe(
        '2026-07-31, 00:00:00',
      );
    });

    // 17:30Z is already the next day in Vietnam — the day must follow the local
    // calendar, not the UTC one.
    it('uses the LOCAL day when the instant has already rolled over', () => {
      const result = startOfDayInTimeZone(
        new Date('2026-07-30T17:30:00.000Z'),
        'Asia/Ho_Chi_Minh',
      );

      expect(localReading(result, 'Asia/Ho_Chi_Minh')).toBe(
        '2026-07-31, 00:00:00',
      );
    });
  });

  describe('negative UTC offsets (the Sprint 04 bug)', () => {
    // Regression: this returned 2026-07-30 before the fix.
    it('resolves local midnight for America/New_York', () => {
      const result = startOfDayInTimeZone(
        new Date('2026-07-31T12:00:00.000Z'),
        'America/New_York',
      );

      expect(localReading(result, 'America/New_York')).toBe(
        '2026-07-31, 00:00:00',
      );
    });

    it('keeps the previous local day when the UTC instant is early morning', () => {
      // 02:00Z on the 31st is 22:00 on the 30th in New York.
      const result = startOfDayInTimeZone(
        new Date('2026-07-31T02:00:00.000Z'),
        'America/New_York',
      );

      expect(localReading(result, 'America/New_York')).toBe(
        '2026-07-30, 00:00:00',
      );
    });

    it('resolves local midnight for a half-hour offset zone', () => {
      const result = startOfDayInTimeZone(
        new Date('2026-07-31T12:00:00.000Z'),
        'America/St_Johns', // UTC-2:30 in summer
      );

      expect(localReading(result, 'America/St_Johns')).toBe(
        '2026-07-31, 00:00:00',
      );
    });
  });

  describe('UTC and zero-ish offsets', () => {
    it('resolves midnight for UTC', () => {
      const result = startOfDayInTimeZone(
        new Date('2026-07-31T12:00:00.000Z'),
        'UTC',
      );

      expect(result.toISOString()).toBe('2026-07-31T00:00:00.000Z');
    });

    it('resolves local midnight for Europe/London during BST', () => {
      const result = startOfDayInTimeZone(
        new Date('2026-07-31T12:00:00.000Z'),
        'Europe/London',
      );

      expect(localReading(result, 'Europe/London')).toBe(
        '2026-07-31, 00:00:00',
      );
      // BST is UTC+1, so local midnight is 23:00Z the day before.
      expect(result.toISOString()).toBe('2026-07-30T23:00:00.000Z');
    });
  });

  describe('DST transitions', () => {
    // 2026-03-08 is the US spring-forward date: that local day is 23h long and
    // the offset at noon differs from the offset at midnight.
    it('resolves midnight on a spring-forward day', () => {
      const result = startOfDayInTimeZone(
        new Date('2026-03-08T18:00:00.000Z'),
        'America/New_York',
      );

      expect(localReading(result, 'America/New_York')).toBe(
        '2026-03-08, 00:00:00',
      );
    });

    // 2026-11-01 is the US fall-back date: that local day is 25h long.
    it('resolves midnight on a fall-back day', () => {
      const result = startOfDayInTimeZone(
        new Date('2026-11-01T18:00:00.000Z'),
        'America/New_York',
      );

      expect(localReading(result, 'America/New_York')).toBe(
        '2026-11-01, 00:00:00',
      );
    });

    it('resolves midnight on a southern-hemisphere transition day', () => {
      const result = startOfDayInTimeZone(
        new Date('2026-10-04T12:00:00.000Z'),
        'Australia/Sydney',
      );

      expect(localReading(result, 'Australia/Sydney')).toBe(
        '2026-10-04, 00:00:00',
      );
    });
  });

  it('is idempotent — the start of a day is its own start of day', () => {
    const once = startOfDayInTimeZone(
      new Date('2026-07-31T12:00:00.000Z'),
      'America/New_York',
    );
    const twice = startOfDayInTimeZone(once, 'America/New_York');

    expect(twice.toISOString()).toBe(once.toISOString());
  });

  it('never returns an instant after the one it was given', () => {
    for (const tz of [
      'UTC',
      'Asia/Ho_Chi_Minh',
      'America/New_York',
      'Europe/London',
      'Australia/Sydney',
    ]) {
      const instant = new Date('2026-07-31T12:00:00.000Z');
      expect(startOfDayInTimeZone(instant, tz).getTime()).toBeLessThanOrEqual(
        instant.getTime(),
      );
    }
  });
});
