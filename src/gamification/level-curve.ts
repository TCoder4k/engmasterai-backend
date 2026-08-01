// Sprint 10 — the XP -> level mapping. Pure: no Prisma, no clock, no I/O.
//
// User.level is a CACHE of levelForXp(User.totalPoints) (see schema.prisma).
// Keeping the rule here rather than inline in the service is what makes that
// claim checkable: there is exactly one definition of what a level is, and it
// can be re-run over any total to rebuild the column.
//
// THE CURVE IS PROGRESSIVE, and that was a deliberate product choice over the
// linear `floor(totalPoints / 100) + 1` that the deleted UserService
// .updatePoints used. Linear means level 101 at 10,000 XP — a number that
// stops meaning anything long before a committed student gets there. Each
// level here costs 50 XP more than the one before it:
//
//   delta(n) = 100 + 50 * (n - 2)      // XP to go from level n-1 to level n
//
//   L1     0        L5    700       L9    2200
//   L2   100        L6   1000       L10   2700
//   L3   250        L7   1350       L20  10450
//   L4   450        L8   1750       L50  63700
//
// (These are illustrative. level-curve.spec.ts holds the authoritative table,
// written out independently of the formula below.)
//
// CHANGING THESE NUMBERS AFTER LAUNCH IS NOT A NEUTRAL EDIT. XP already
// earned is never recomputed, so a student who reached level 6 under one curve
// and a student who reaches it under the next did different amounts of work.

/** Level everybody starts at. Nothing is ever below this, including at 0 XP. */
export const MIN_LEVEL = 1;

// The first increment (level 1 -> 2) and how much each subsequent one grows.
// Extracted so the closed form below and the spec's independent re-derivation
// cannot silently disagree about the constants.
const BASE_STEP = 100;
const STEP_GROWTH = 50;

/**
 * Total XP required to REACH `level`.
 *
 * Closed form rather than a lookup table, so there is no highest level and no
 * `undefined` to handle at the end of an array — a student past the last
 * tabulated row is a real case, and a table would either cap them or crash.
 *
 * Sum of deltas for levels 2..L:
 *   sum(100 + 50*(n-2)) for n=2..L  =  (L-1)*100 + 50*(L-2)(L-1)/2
 */
export const xpThresholdForLevel = (level: number): number => {
  if (level <= MIN_LEVEL) return 0;
  const steps = level - 1;
  return steps * BASE_STEP + (STEP_GROWTH * (steps - 1) * steps) / 2;
};

/**
 * The level a given lifetime XP total earns.
 *
 * Negative totals are clamped to level 1 rather than rejected: the ledger only
 * writes positive amounts in Sprint 10, so a negative total would mean data
 * corruption, and a student's dashboard is not the place to surface that as a
 * crash.
 */
export const levelForXp = (totalXp: number): number => {
  if (!Number.isFinite(totalXp) || totalXp <= 0) return MIN_LEVEL;

  // Walk up while the NEXT level is affordable. Bounded by the curve's own
  // growth — the thresholds are quadratic, so even Number.MAX_SAFE_INTEGER
  // terminates in a few tens of thousands of iterations. A binary search would
  // be faster and much harder to read for a value that is computed once per
  // award.
  let level = MIN_LEVEL;
  while (totalXp >= xpThresholdForLevel(level + 1)) level += 1;
  return level;
};

export interface LevelProgress {
  level: number;
  /** Lifetime XP, unchanged — the number the ledger actually holds. */
  totalXp: number;
  /** XP earned since reaching `level`. */
  intoLevel: number;
  /** XP still needed to reach `level + 1`. Never 0 — the curve has no cap. */
  toNextLevel: number;
  /** 0-100, floored. Only a genuine full bar shows 100. */
  percent: number;
}

/**
 * Everything the level widget needs, derived in one place.
 *
 * `percent` is FLOORED, matching deriveCourseSummary and the SRS percentages
 * (ADR 007 §5): 1 XP into a 350-XP level must not round up to look like more,
 * and 99.6% must not display as a finished bar.
 */
export const levelProgress = (totalXp: number): LevelProgress => {
  const safeTotal = Number.isFinite(totalXp) && totalXp > 0 ? totalXp : 0;
  const level = levelForXp(safeTotal);
  const floor = xpThresholdForLevel(level);
  const ceiling = xpThresholdForLevel(level + 1);

  const span = ceiling - floor;
  const intoLevel = safeTotal - floor;

  return {
    level,
    totalXp: safeTotal,
    intoLevel,
    toNextLevel: ceiling - safeTotal,
    percent: span > 0 ? Math.floor((intoLevel / span) * 100) : 0,
  };
};
