// Sprint 10 — the shared shape of a "this request replayed correctly" check.
//
// Every idempotent endpoint in this backend (quiz submit, practice submit, SRS
// review) now returns TWO things: the original recorded outcome, which must
// replay byte for byte, and an EPHEMERAL gamification result, which must NOT.
//
// `toEqual(first.body)` used to say both at once. It cannot any more, and
// loosening it to `toMatchObject` would quietly stop checking the half that
// matters. So the assertion is split here, once, rather than three times in
// three suites that would drift.
//
// WHY THE GAMIFICATION HALF MUST DIFFER. The award already happened; the
// ledger row exists; ON CONFLICT DO NOTHING skipped the second insert. If the
// response repeated `xpAwarded: 70`, the client would fire its "+70 XP" toast
// again for XP that was granted once. The stored body deliberately carries no
// gamification field at all (see TaskSubmitOutcome) — this asserts the
// consequence of that design from the outside.

interface WithGamification {
  gamification?: { xpAwarded: number; xp: { totalXp: number } };
}

/** The response minus its ephemeral half — the part that must replay exactly. */
export const recordedOutcomeOf = <T extends WithGamification>(body: T) => {
  const { gamification: _gamification, ...recorded } = body;
  return recorded;
};

/**
 * Assert a replay: same recorded outcome, and NO second award.
 *
 * `expectedFirstAward` is passed explicitly so each caller states what the
 * original request was worth. A replay that returned the original award would
 * pass a bare "> 0" check.
 */
export const expectIdempotentReplay = (
  first: WithGamification,
  replay: WithGamification,
  expectedFirstAward: number,
): void => {
  expect(recordedOutcomeOf(replay)).toEqual(recordedOutcomeOf(first));

  expect(first.gamification?.xpAwarded).toBe(expectedFirstAward);
  expect(replay.gamification?.xpAwarded).toBe(0);

  // The running total still comes back, so a client that retried does not have
  // to refetch to keep its level widget honest.
  //
  // Asserted as ">=" rather than "==" ON PURPOSE. A replay reports the total
  // AS IT IS NOW, and real work can legitimately have happened in between —
  // the learning suite submits a second, different review between the original
  // and the replay, which is exactly the interleaving a student produces by
  // retrying a request that timed out. What must never happen is the total
  // going BACKWARDS, which is what a replay re-deriving state from a stale
  // snapshot would do.
  expect(replay.gamification?.xp.totalXp).toBeGreaterThanOrEqual(
    first.gamification?.xp.totalXp ?? 0,
  );
};
