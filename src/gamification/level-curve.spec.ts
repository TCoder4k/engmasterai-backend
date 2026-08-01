import {
  levelForXp,
  levelProgress,
  MIN_LEVEL,
  xpThresholdForLevel,
} from './level-curve';

// The thresholds, written out INDEPENDENTLY of the closed form in
// level-curve.ts — this table is the spec, the formula is the implementation.
// Re-deriving them with the same expression would test nothing.
//
//   level 2 costs 100, level 3 costs 150, level 4 costs 200, ...
const EXPECTED_THRESHOLDS: Array<[level: number, xp: number]> = [
  [1, 0],
  [2, 100], // 100
  [3, 250], // +150
  [4, 450], // +200
  [5, 700], // +250
  [6, 1000], // +300
  [7, 1350], // +350
  [8, 1750], // +400
  [9, 2200], // +450
  [10, 2700], // +500
];

describe('xpThresholdForLevel', () => {
  it.each(EXPECTED_THRESHOLDS)('level %i requires %i XP', (level, xp) => {
    expect(xpThresholdForLevel(level)).toBe(xp);
  });

  it('treats level 1 and anything below it as 0 XP', () => {
    expect(xpThresholdForLevel(1)).toBe(0);
    expect(xpThresholdForLevel(0)).toBe(0);
    expect(xpThresholdForLevel(-5)).toBe(0);
  });

  it('grows by an ever-larger step, never a constant one', () => {
    // Guards the whole point of replacing floor(xp/100)+1: if someone
    // "simplifies" the curve back to linear, the deltas stop growing.
    const deltas: number[] = [];
    for (let level = 2; level <= 12; level += 1) {
      deltas.push(xpThresholdForLevel(level) - xpThresholdForLevel(level - 1));
    }
    for (let i = 1; i < deltas.length; i += 1) {
      expect(deltas[i]).toBeGreaterThan(deltas[i - 1]);
    }
  });
});

describe('levelForXp', () => {
  it('starts every account at level 1 with no XP', () => {
    expect(levelForXp(0)).toBe(MIN_LEVEL);
  });

  it.each(EXPECTED_THRESHOLDS)(
    'awards level %i at exactly %i XP',
    (level, xp) => {
      expect(levelForXp(xp)).toBe(level);
    },
  );

  it.each(EXPECTED_THRESHOLDS.filter(([level]) => level > 1))(
    'is still level %i minus one at %i-1 XP',
    (level, xp) => {
      // The boundary in the other direction. Off-by-one here would silently
      // promote every student one level early, which is unrecoverable once
      // User.level has been written.
      expect(levelForXp(xp - 1)).toBe(level - 1);
    },
  );

  it('never returns undefined or NaN past the tabulated range', () => {
    // A lookup table would fall off its end here; the closed form must not.
    const huge = levelForXp(10_000_000);
    expect(Number.isInteger(huge)).toBe(true);
    expect(huge).toBeGreaterThan(10);
    expect(xpThresholdForLevel(huge)).toBeLessThanOrEqual(10_000_000);
    expect(xpThresholdForLevel(huge + 1)).toBeGreaterThan(10_000_000);
  });

  it('clamps corrupt totals to level 1 rather than throwing', () => {
    // Sprint 10 only ever writes positive amounts, so a negative total means
    // the data is wrong — and a student's dashboard is not where that should
    // surface as a 500.
    expect(levelForXp(-100)).toBe(MIN_LEVEL);
    expect(levelForXp(Number.NaN)).toBe(MIN_LEVEL);
    expect(levelForXp(Number.POSITIVE_INFINITY)).toBe(MIN_LEVEL);
  });

  it('is monotonic: more XP never means a lower level', () => {
    let previous = MIN_LEVEL;
    for (let xp = 0; xp <= 5000; xp += 7) {
      const level = levelForXp(xp);
      expect(level).toBeGreaterThanOrEqual(previous);
      previous = level;
    }
  });
});

describe('levelProgress', () => {
  it('reports a fresh account as level 1, 0/100', () => {
    expect(levelProgress(0)).toEqual({
      level: 1,
      totalXp: 0,
      intoLevel: 0,
      toNextLevel: 100,
      percent: 0,
    });
  });

  it('splits a mid-level total into progress within that level', () => {
    // 1240 XP: level 6 (1000), 240 into a 350-wide level.
    expect(levelProgress(1240)).toEqual({
      level: 6,
      totalXp: 1240,
      intoLevel: 240,
      toNextLevel: 110,
      percent: 68, // floor(240/350*100) = 68
    });
  });

  it('resets intoLevel to 0 at the moment a level is reached', () => {
    const atBoundary = levelProgress(1000);
    expect(atBoundary.level).toBe(6);
    expect(atBoundary.intoLevel).toBe(0);
    expect(atBoundary.percent).toBe(0);
  });

  it('floors the percentage so a nearly-full bar never reads 100', () => {
    // One XP short of level 7. Rounding would show 100% on an unfinished
    // level — the same lie deriveCourseSummary floors to avoid.
    const almost = levelProgress(1349);
    expect(almost.level).toBe(6);
    expect(almost.toNextLevel).toBe(1);
    expect(almost.percent).toBe(99);
  });

  it('keeps totalXp as the raw lifetime figure, never a per-level one', () => {
    expect(levelProgress(1240).totalXp).toBe(1240);
  });
});
