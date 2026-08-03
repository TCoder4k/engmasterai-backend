import { creditableSeconds } from './creditable-seconds';

// Sprint 10.5 — the convergence cap's boundary table.
//
// Written BEFORE the function was wired into StudyTimeService, deliberately.
// This is the only place the cap's edges can be chosen rather than observed:
// in e2e, `elapsedToday` is whatever the clock says when the suite runs.

describe('creditableSeconds — the ordinary case', () => {
  it('credits the full request when the day has plenty of headroom', () => {
    expect(
      creditableSeconds({ requested: 60, usedToday: 600, elapsedToday: 7200 }),
    ).toBe(60);
  });

  it('never credits more than was requested, however large the headroom', () => {
    expect(
      creditableSeconds({ requested: 60, usedToday: 0, elapsedToday: 86_400 }),
    ).toBe(60);
  });

  it('credits a student studying continuously since local midnight', () => {
    // The invariant that matters most: genuine, uninterrupted study is never
    // refused. used + requested == elapsed exactly.
    expect(
      creditableSeconds({ requested: 60, usedToday: 3540, elapsedToday: 3600 }),
    ).toBe(60);
  });
});

describe('creditableSeconds — the cap engaging', () => {
  it('clamps to the remaining headroom when the request overshoots', () => {
    expect(
      creditableSeconds({ requested: 60, usedToday: 3570, elapsedToday: 3600 }),
    ).toBe(30);
  });

  it('credits ZERO once the day is exactly spent', () => {
    expect(
      creditableSeconds({ requested: 60, usedToday: 3600, elapsedToday: 3600 }),
    ).toBe(0);
  });

  it('credits ZERO while concurrent clients have over-credited — convergence', () => {
    // N clients each raced past the ceiling. Every heartbeat from here on is
    // refused until real time catches up, so over-credit cannot accumulate.
    expect(
      creditableSeconds({ requested: 60, usedToday: 3800, elapsedToday: 3600 }),
    ).toBe(0);
  });

  it('credits ZERO at the very start of a local day', () => {
    expect(
      creditableSeconds({ requested: 60, usedToday: 0, elapsedToday: 0 }),
    ).toBe(0);
  });

  it('credits ZERO when the clock reports a day boundary in the future', () => {
    expect(
      creditableSeconds({ requested: 60, usedToday: 0, elapsedToday: -120 }),
    ).toBe(0);
  });
});

describe('creditableSeconds — degenerate input', () => {
  it.each([0, -1, -3600])('credits ZERO for a request of %s', (requested) => {
    expect(
      creditableSeconds({ requested, usedToday: 0, elapsedToday: 3600 }),
    ).toBe(0);
  });

  it.each([NaN, Infinity, -Infinity])(
    'credits ZERO for a non-finite request (%s)',
    (requested) => {
      expect(
        creditableSeconds({ requested, usedToday: 0, elapsedToday: 3600 }),
      ).toBe(0);
    },
  );

  it('credits ZERO when the day totals are not finite', () => {
    expect(
      creditableSeconds({ requested: 60, usedToday: NaN, elapsedToday: 3600 }),
    ).toBe(0);
    expect(
      creditableSeconds({ requested: 60, usedToday: 0, elapsedToday: NaN }),
    ).toBe(0);
  });

  it('always returns an integer, even from fractional input', () => {
    expect(
      creditableSeconds({ requested: 60.9, usedToday: 0, elapsedToday: 7200 }),
    ).toBe(60);
    expect(
      creditableSeconds({
        requested: 60,
        usedToday: 3570.4,
        elapsedToday: 3600,
      }),
    ).toBe(29);
  });
});
