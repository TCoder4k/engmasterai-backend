import { activityDayFor, dayKeyToDate, isSameActivityDay } from './day-key';

// The zones are chosen to cover the four ways this conversion can go wrong:
// a positive offset (the product's own userbase), a NEGATIVE one (the class of
// bug Sprint 09 found live in startOfDayInTimeZone), a half-hour offset, and a
// DST transition.
const VN = 'Asia/Ho_Chi_Minh'; // UTC+7, no DST
const NY = 'America/New_York'; // UTC-4 / -5, DST
const KOLKATA = 'Asia/Kolkata'; // UTC+5:30

describe('dayKeyToDate', () => {
  it('encodes a day key as the UTC midnight Postgres will store as that DATE', () => {
    expect(dayKeyToDate('2026-07-31').toISOString()).toBe(
      '2026-07-31T00:00:00.000Z',
    );
  });

  it('handles month and year boundaries', () => {
    expect(dayKeyToDate('2026-01-01').toISOString()).toBe(
      '2026-01-01T00:00:00.000Z',
    );
    expect(dayKeyToDate('2026-12-31').toISOString()).toBe(
      '2026-12-31T00:00:00.000Z',
    );
  });

  it('handles a leap day', () => {
    expect(dayKeyToDate('2028-02-29').toISOString()).toBe(
      '2028-02-29T00:00:00.000Z',
    );
  });

  it('throws on a malformed key rather than producing an Invalid Date', () => {
    // An Invalid Date would reach Prisma and land as a NULL or a wrong row,
    // with nothing in the logs pointing back here.
    expect(() => dayKeyToDate('2026-7-31')).toThrow(RangeError);
    expect(() => dayKeyToDate('31/07/2026')).toThrow(RangeError);
    expect(() => dayKeyToDate('2026-07-31T00:00:00Z')).toThrow(RangeError);
    expect(() => dayKeyToDate('')).toThrow(RangeError);
  });
});

describe('activityDayFor', () => {
  it('files 00:30 Vietnam time under TODAY, not yesterday', () => {
    // The carrying check of Sprint 09, now also deciding which activity row is
    // created and therefore which day a streak counts.
    // 2026-07-30T17:30Z is 2026-07-31 00:30 in UTC+7.
    const instant = new Date('2026-07-30T17:30:00.000Z');
    expect(activityDayFor(instant, VN).toISOString()).toBe(
      '2026-07-31T00:00:00.000Z',
    );
  });

  it('files 23:30 Vietnam time under that same day, not tomorrow', () => {
    // 2026-07-31T16:30Z is 2026-07-31 23:30 in UTC+7.
    const instant = new Date('2026-07-31T16:30:00.000Z');
    expect(activityDayFor(instant, VN).toISOString()).toBe(
      '2026-07-31T00:00:00.000Z',
    );
  });

  it('is correct for a NEGATIVE offset', () => {
    // The regression class Sprint 09 fixed. Midday UTC is still the morning of
    // the same date in New York...
    expect(
      activityDayFor(new Date('2026-07-31T12:00:00.000Z'), NY).toISOString(),
    ).toBe('2026-07-31T00:00:00.000Z');

    // ...but 02:00 UTC is still the PREVIOUS evening there.
    expect(
      activityDayFor(new Date('2026-07-31T02:00:00.000Z'), NY).toISOString(),
    ).toBe('2026-07-30T00:00:00.000Z');
  });

  it('is correct for a half-hour offset', () => {
    // 2026-07-30T19:00Z is 2026-07-31 00:30 in UTC+5:30.
    expect(
      activityDayFor(
        new Date('2026-07-30T19:00:00.000Z'),
        KOLKATA,
      ).toISOString(),
    ).toBe('2026-07-31T00:00:00.000Z');
  });

  it('is correct across a DST transition', () => {
    // US DST ends 2026-11-01 at 02:00 local. 05:30Z is 01:30 EDT (UTC-4),
    // 06:30Z is 01:30 EST (UTC-5) — the same wall clock, an hour apart, both
    // still on the 1st.
    expect(
      activityDayFor(new Date('2026-11-01T05:30:00.000Z'), NY).toISOString(),
    ).toBe('2026-11-01T00:00:00.000Z');
    expect(
      activityDayFor(new Date('2026-11-01T06:30:00.000Z'), NY).toISOString(),
    ).toBe('2026-11-01T00:00:00.000Z');
  });

  it('puts the same instant on different days for different zones', () => {
    // The whole reason the zone is stored alongside the day: this instant is
    // genuinely two different calendar days for two students.
    const instant = new Date('2026-07-30T17:30:00.000Z');
    expect(activityDayFor(instant, VN).toISOString()).toBe(
      '2026-07-31T00:00:00.000Z',
    );
    expect(activityDayFor(instant, 'UTC').toISOString()).toBe(
      '2026-07-30T00:00:00.000Z',
    );
  });
});

describe('isSameActivityDay', () => {
  it('is true across a long gap inside one local day', () => {
    // 07:00 and 23:00 Vietnam time on the same date.
    expect(
      isSameActivityDay(
        new Date('2026-07-31T00:00:00.000Z'),
        new Date('2026-07-31T16:00:00.000Z'),
        VN,
      ),
    ).toBe(true);
  });

  it('is false across local midnight even for a short gap', () => {
    // 23:30 and 00:30 Vietnam time — one hour apart, two different days, so
    // the hot-path guard must NOT skip creating the new day's row.
    expect(
      isSameActivityDay(
        new Date('2026-07-31T16:30:00.000Z'),
        new Date('2026-07-31T17:30:00.000Z'),
        VN,
      ),
    ).toBe(false);
  });

  it('answers per zone, not by subtracting timestamps', () => {
    // Same two instants, opposite answers depending on the student's zone.
    const a = new Date('2026-07-30T17:30:00.000Z');
    const b = new Date('2026-07-30T20:00:00.000Z');
    expect(isSameActivityDay(a, b, VN)).toBe(true); // 00:30 and 03:00 on the 31st
    expect(isSameActivityDay(a, b, 'UTC')).toBe(true); // 17:30 and 20:00 on the 30th

    const c = new Date('2026-07-30T16:00:00.000Z'); // 23:00 VN on the 30th
    const d = new Date('2026-07-30T18:00:00.000Z'); // 01:00 VN on the 31st
    expect(isSameActivityDay(c, d, VN)).toBe(false);
    expect(isSameActivityDay(c, d, 'UTC')).toBe(true);
  });
});
