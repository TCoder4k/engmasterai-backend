import {
  next,
  previewIntervals,
  ProgressSnapshot,
  DEFAULT_NEW_PROGRESS,
  MASTERY_MIN_INTERVAL_DAYS,
  MASTERY_MIN_REPETITIONS,
} from './scheduler';

// Fixed "now" so every expectation below is a deterministic date, never a
// flaky Date.now()-relative one.
const NOW = new Date('2026-01-01T00:00:00.000Z');
const PAST = new Date('2025-06-01T00:00:00.000Z');

const snapshot = (overrides: Partial<ProgressSnapshot>): ProgressSnapshot => ({
  ...DEFAULT_NEW_PROGRESS,
  ...overrides,
});

describe('scheduler.next — full (state, rating) matrix (sprint plan §6)', () => {
  // One representative input per state, deliberately with different
  // interval/repetitions/ease/lapses values so a bug that swaps two
  // fields can't hide behind coincidentally-equal numbers.
  const NEW_INPUT = snapshot({ state: 'NEW' });
  const LEARNING_INPUT = snapshot({ state: 'LEARNING', intervalDays: 1 });
  const REVIEW_INPUT = snapshot({
    state: 'REVIEW',
    easeFactor: 2.5,
    intervalDays: 6,
    repetitions: 2,
    firstLearnedAt: PAST,
  });
  const RELEARNING_INPUT = snapshot({
    state: 'RELEARNING',
    easeFactor: 2.3,
    intervalDays: 1,
    repetitions: 4,
    lapses: 1,
    firstLearnedAt: PAST,
  });
  const MASTERED_INPUT = snapshot({
    state: 'MASTERED',
    easeFactor: 2.6,
    intervalDays: 25,
    repetitions: 4,
    masteredAt: PAST,
    firstLearnedAt: PAST,
  });

  it.each([
    [
      'NEW',
      NEW_INPUT,
      'AGAIN',
      {
        state: 'LEARNING',
        intervalDays: 1,
        repetitions: 0,
        easeFactor: 2.5,
        lapses: 0,
      },
    ],
    [
      'NEW',
      NEW_INPUT,
      'HARD',
      {
        state: 'LEARNING',
        intervalDays: 1,
        repetitions: 0,
        easeFactor: 2.5,
        lapses: 0,
      },
    ],
    [
      'NEW',
      NEW_INPUT,
      'GOOD',
      { state: 'REVIEW', intervalDays: 1, repetitions: 1, easeFactor: 2.5 },
    ],
    [
      'NEW',
      NEW_INPUT,
      'EASY',
      { state: 'REVIEW', intervalDays: 4, repetitions: 1, easeFactor: 2.65 },
    ],

    // LEARNING must match NEW's results exactly (both are "pre-graduation")
    // — proves the state itself doesn't matter, only the shared invariant
    // that a pre-graduation word always has repetitions === 0.
    [
      'LEARNING',
      LEARNING_INPUT,
      'AGAIN',
      {
        state: 'LEARNING',
        intervalDays: 1,
        repetitions: 0,
        easeFactor: 2.5,
        lapses: 0,
      },
    ],
    [
      'LEARNING',
      LEARNING_INPUT,
      'HARD',
      {
        state: 'LEARNING',
        intervalDays: 1,
        repetitions: 0,
        easeFactor: 2.5,
        lapses: 0,
      },
    ],
    [
      'LEARNING',
      LEARNING_INPUT,
      'GOOD',
      { state: 'REVIEW', intervalDays: 1, repetitions: 1, easeFactor: 2.5 },
    ],
    [
      'LEARNING',
      LEARNING_INPUT,
      'EASY',
      { state: 'REVIEW', intervalDays: 4, repetitions: 1, easeFactor: 2.65 },
    ],

    [
      'REVIEW',
      REVIEW_INPUT,
      'AGAIN',
      {
        state: 'RELEARNING',
        intervalDays: 1,
        repetitions: 2,
        easeFactor: 2.3,
        lapses: 1,
      },
    ],
    [
      'REVIEW',
      REVIEW_INPUT,
      'HARD',
      {
        state: 'REVIEW',
        intervalDays: 7,
        repetitions: 3,
        easeFactor: 2.35,
        lapses: 0,
      },
    ],
    [
      'REVIEW',
      REVIEW_INPUT,
      'GOOD',
      { state: 'REVIEW', intervalDays: 15, repetitions: 3, easeFactor: 2.5 },
    ],
    // 6 * (2.5 + 0.15) * 1.3 = 20.67 -> rounds to 21, exactly the mastery
    // interval floor — a deliberate boundary case (>= not >).
    [
      'REVIEW',
      REVIEW_INPUT,
      'EASY',
      { state: 'MASTERED', intervalDays: 21, repetitions: 3, easeFactor: 2.65 },
    ],

    [
      'RELEARNING',
      RELEARNING_INPUT,
      'AGAIN',
      {
        state: 'RELEARNING',
        intervalDays: 1,
        repetitions: 4,
        easeFactor: 2.3,
        lapses: 1,
      },
    ],
    [
      'RELEARNING',
      RELEARNING_INPUT,
      'HARD',
      {
        state: 'RELEARNING',
        intervalDays: 1,
        repetitions: 4,
        easeFactor: 2.3,
        lapses: 1,
      },
    ],
    [
      'RELEARNING',
      RELEARNING_INPUT,
      'GOOD',
      { state: 'REVIEW', intervalDays: 2, repetitions: 5, easeFactor: 2.3 },
    ],
    [
      'RELEARNING',
      RELEARNING_INPUT,
      'EASY',
      { state: 'REVIEW', intervalDays: 3, repetitions: 5, easeFactor: 2.45 },
    ],

    // MASTERED + AGAIN/HARD both demote — AGAIN via the generic
    // REVIEW||MASTERED lapse branch, HARD via its own explicit,
    // never-re-promoted-in-the-same-call branch.
    [
      'MASTERED',
      MASTERED_INPUT,
      'AGAIN',
      {
        state: 'RELEARNING',
        intervalDays: 1,
        repetitions: 4,
        easeFactor: 2.4,
        lapses: 1,
      },
    ],
    [
      'MASTERED',
      MASTERED_INPUT,
      'HARD',
      { state: 'REVIEW', intervalDays: 30, repetitions: 5, easeFactor: 2.45 },
    ],
    [
      'MASTERED',
      MASTERED_INPUT,
      'GOOD',
      { state: 'MASTERED', intervalDays: 65, repetitions: 5, easeFactor: 2.6 },
    ],
    [
      'MASTERED',
      MASTERED_INPUT,
      'EASY',
      { state: 'MASTERED', intervalDays: 89, repetitions: 5, easeFactor: 2.75 },
    ],
  ])('%s + %s', (_label, input, rating, expected) => {
    const result = next(input, rating as never, NOW);
    expect(result).toMatchObject(expected);
  });

  it('MASTERED + AGAIN clears masteredAt (lapse demotion)', () => {
    const result = next(MASTERED_INPUT, 'AGAIN', NOW);
    expect(result.masteredAt).toBeNull();
  });

  it('MASTERED + HARD clears masteredAt and does NOT get silently re-promoted, even though the resulting interval/repetitions would numerically qualify', () => {
    const result = next(MASTERED_INPUT, 'HARD', NOW);
    expect(result.intervalDays).toBeGreaterThanOrEqual(
      MASTERY_MIN_INTERVAL_DAYS,
    );
    expect(result.repetitions).toBeGreaterThanOrEqual(MASTERY_MIN_REPETITIONS);
    expect(result.state).toBe('REVIEW'); // not MASTERED — explicit demotion, no immediate re-check
    expect(result.masteredAt).toBeNull();
  });

  it('MASTERED + GOOD/EASY re-affirms MASTERED without re-stamping masteredAt', () => {
    const good = next(MASTERED_INPUT, 'GOOD', NOW);
    const easy = next(MASTERED_INPUT, 'EASY', NOW);
    expect(good.state).toBe('MASTERED');
    expect(good.masteredAt).toEqual(PAST); // unchanged, never re-stamped
    expect(easy.state).toBe('MASTERED');
    expect(easy.masteredAt).toEqual(PAST);
  });

  it('a lapse (REVIEW/MASTERED -> RELEARNING via AGAIN) does NOT reset repetitions', () => {
    const result = next(REVIEW_INPUT, 'AGAIN', NOW);
    expect(result.repetitions).toBe(REVIEW_INPUT.repetitions); // unchanged, not reset to 0
  });

  it('repeated AGAIN while already RELEARNING does not increment lapses again', () => {
    const first = next(REVIEW_INPUT, 'AGAIN', NOW); // REVIEW -> RELEARNING, lapses 0 -> 1
    const second = next(
      { ...REVIEW_INPUT, state: first.state, lapses: first.lapses },
      'AGAIN',
      NOW,
    );
    expect(second.lapses).toBe(first.lapses); // still 1, not 2
  });

  it('Hard and Again are identical for a brand-new (NEW/LEARNING) word — resolved via preview, not a semantics change', () => {
    const again = next(NEW_INPUT, 'AGAIN', NOW);
    const hard = next(NEW_INPUT, 'HARD', NOW);
    expect(hard).toEqual(again);
  });
});

describe('scheduler.next — ease-factor clamping', () => {
  it('never drops easeFactor below MIN_EASE_FACTOR (1.3)', () => {
    const input = snapshot({
      state: 'REVIEW',
      easeFactor: 1.35,
      intervalDays: 10,
      repetitions: 5,
    });
    const result = next(input, 'HARD', NOW);
    expect(result.easeFactor).toBe(1.3); // 1.35 - 0.15 = 1.2, clamped up to the floor
  });

  it('never raises easeFactor above MAX_EASE_FACTOR (3.0)', () => {
    const input = snapshot({
      state: 'REVIEW',
      easeFactor: 2.95,
      intervalDays: 10,
      repetitions: 5,
    });
    const result = next(input, 'EASY', NOW);
    expect(result.easeFactor).toBe(3.0); // 2.95 + 0.15 = 3.10, clamped down to the ceiling
  });
});

describe('scheduler.next — mastery requires BOTH the interval floor AND the repetitions floor', () => {
  it('does not master from a huge interval alone when repetitions is still below the floor', () => {
    // priorRepetitions = 1 here, so this is only the word's *second* ever
    // successful rating (GOOD's fixed-6-day step doesn't apply to EASY),
    // yet the ease-multiplied interval alone would already clear 21 days —
    // proving the repetitions >= 3 floor is load-bearing, not redundant
    // with the interval formula.
    const input = snapshot({
      state: 'REVIEW',
      easeFactor: 2.5,
      intervalDays: 50,
      repetitions: 1,
    });
    const result = next(input, 'EASY', NOW);
    expect(result.repetitions).toBe(2);
    expect(result.intervalDays).toBeGreaterThanOrEqual(
      MASTERY_MIN_INTERVAL_DAYS,
    );
    expect(result.state).toBe('REVIEW'); // not MASTERED — repetitions floor blocks it
    expect(result.masteredAt).toBeNull();
  });

  it('masters once a later rating pushes repetitions past the floor too', () => {
    const input = snapshot({
      state: 'REVIEW',
      easeFactor: 2.5,
      intervalDays: 50,
      repetitions: 1,
    });
    const afterFirst = next(input, 'EASY', NOW); // repetitions 1 -> 2, not yet mastered (see above)
    const afterSecond = next(
      {
        ...input,
        easeFactor: afterFirst.easeFactor,
        intervalDays: afterFirst.intervalDays,
        repetitions: afterFirst.repetitions,
      },
      'EASY',
      NOW,
    );
    expect(afterSecond.repetitions).toBe(3);
    expect(afterSecond.intervalDays).toBeGreaterThanOrEqual(
      MASTERY_MIN_INTERVAL_DAYS,
    );
    expect(afterSecond.state).toBe('MASTERED');
    expect(afterSecond.masteredAt).toEqual(NOW); // stamped for the first time
  });

  it('never masters on the very first rating, regardless of which rating is chosen', () => {
    for (const rating of ['AGAIN', 'HARD', 'GOOD', 'EASY'] as const) {
      const result = next(DEFAULT_NEW_PROGRESS, rating, NOW);
      expect(result.state).not.toBe('MASTERED');
    }
  });
});

describe('scheduler.next — date math (UTC-only, day-granularity)', () => {
  it('crosses a year boundary correctly', () => {
    const now = new Date('2026-12-30T00:00:00.000Z');
    const result = next(DEFAULT_NEW_PROGRESS, 'EASY', now); // +4 days
    expect(result.nextReviewAt.toISOString()).toBe('2027-01-03T00:00:00.000Z');
  });

  it('crosses a leap-year February correctly (2028 is a leap year)', () => {
    const now = new Date('2028-02-27T00:00:00.000Z');
    const result = next(DEFAULT_NEW_PROGRESS, 'EASY', now); // +4 days, through Feb 29
    expect(result.nextReviewAt.toISOString()).toBe('2028-03-02T00:00:00.000Z');
  });

  it('steps by exactly N*24h in UTC across a real-world DST transition date, proving no local-time skew is introduced', () => {
    const now = new Date('2026-03-06T00:00:00.000Z'); // straddles a US DST transition weekend
    const result = next(DEFAULT_NEW_PROGRESS, 'EASY', now); // +4 days
    const diffMs = result.nextReviewAt.getTime() - now.getTime();
    expect(diffMs).toBe(4 * 24 * 60 * 60 * 1000);
  });
});

describe('previewIntervals', () => {
  it('matches what next() would actually produce for each rating, with zero persistence and no mutation of the input', () => {
    const input = snapshot({
      state: 'REVIEW',
      easeFactor: 2.5,
      intervalDays: 6,
      repetitions: 2,
    });
    const before = { ...input };

    const preview = previewIntervals(input, NOW);

    expect(preview.again).toBe(next(input, 'AGAIN', NOW).intervalDays);
    expect(preview.hard).toBe(next(input, 'HARD', NOW).intervalDays);
    expect(preview.good).toBe(next(input, 'GOOD', NOW).intervalDays);
    expect(preview.easy).toBe(next(input, 'EASY', NOW).intervalDays);
    expect(input).toEqual(before); // never mutated
  });

  it('shows Again and Hard as identical for a new word, exactly matching the clarification this capability resolves', () => {
    const preview = previewIntervals(DEFAULT_NEW_PROGRESS, NOW);
    expect(preview.again).toBe(preview.hard);
    expect(preview.good).toBeLessThan(preview.easy);
  });
});
