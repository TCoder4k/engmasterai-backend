// Sprint 10.5 — the ONE arithmetic rule that decides how many seconds of a
// heartbeat are actually credited. Pure: no Prisma, no clock, no I/O.
//
// WHY THIS IS A SEPARATE FILE for a four-line calculation, and why it is
// tested before it is wired into anything.
//
// `elapsedToday` in an e2e test is real time since the test machine's local
// midnight. Run the suite at 15:00 and it is ~54,000 seconds, so the cap is
// never reached and an assertion like `total <= elapsed + tolerance` passes
// while proving nothing. That is the "green suite that cannot see the defect"
// class Sprint 10's QA pass documented five times over. The boundary behaviour
// therefore gets exhaustive unit coverage HERE, where the inputs are chosen
// rather than observed, and the e2e suite seeds rows to force the cap to
// engage instead of hoping the clock cooperates.
//
// Same reason level-curve.ts is not inside GamificationService: a numeric rule
// that decides a figure the student sees must be testable without a database.
//
// THE GUARANTEE IS A CONVERGENT CEILING, NOT AN ABSOLUTE ONE.
//
// The caller reads `usedToday` and writes in one transaction at Postgres's
// default READ COMMITTED, with no row lock — so N concurrent clients can each
// observe the same `usedToday` and each be credited. The resulting properties:
//
//   * bounded    total(t) <= elapsed(t) + MAX_FLUSH_SECONDS * N
//   * convergent once total >= elapsed, every later heartbeat credits 0 until
//                 real time catches up. Over-credit does not accumulate.
//
// That is enough to stop the abuse this exists for (five devices running all
// day must not yield five times the minutes) without SERIALIZABLE or row locks
// on the hottest write path in the feature.
//
// IT NEVER REFUSES GENUINE STUDY TIME. `usedToday` and `elapsedToday` are both
// measured from the same `dayStart`, so a student studying continuously always
// satisfies used + active <= elapsed. Only time credited beyond the wall clock
// is ever clamped away.

export interface CreditableSecondsInput {
  /** Active seconds the client is asking to be credited, already DTO-bounded. */
  requested: number;
  /** Seconds already credited to this user since the start of their local day. */
  usedToday: number;
  /** Real seconds elapsed since the start of that same local day. */
  elapsedToday: number;
}

/**
 * How many of `requested` seconds may be credited, given what the day has
 * already spent and how much real time it has actually contained.
 *
 * Always a non-negative integer, and never more than `requested`.
 */
export const creditableSeconds = ({
  requested,
  usedToday,
  elapsedToday,
}: CreditableSecondsInput): number => {
  // A non-finite input can only come from a bug upstream; crediting NaN would
  // write a null-ish column rather than fail loudly, so it is floored to zero.
  if (!Number.isFinite(requested) || requested <= 0) return 0;
  if (!Number.isFinite(usedToday) || !Number.isFinite(elapsedToday)) return 0;

  // Negative headroom happens two legitimate ways: concurrent clients have
  // already over-credited (the convergence case), and a clock adjustment moved
  // `now` behind `dayStart`. Both mean "credit nothing", not "credit a
  // negative amount".
  const headroom = elapsedToday - usedToday;
  if (headroom <= 0) return 0;

  return Math.min(Math.floor(requested), Math.floor(headroom));
};
