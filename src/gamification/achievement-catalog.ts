// Sprint 10 — the achievement catalog. Pure: no Prisma, no clock, no I/O.
//
// DEFINITIONS LIVE IN CODE, NOT IN THE DATABASE, for the same reason
// QuestionType is a closed enum and GRADERS is a code registry: an achievement
// needs a PREDICATE, and a database row cannot carry one. Adding a badge is
// one entry here plus one test. There is deliberately no admin authoring UI —
// that is scope control, not an omission.
//
// TWO PROPERTIES THIS FILE MUST KEEP. Both are asserted by the spec, because
// both are load-bearing for decisions made elsewhere:
//
// 1. EVERY ENTRY GRANTS xp > 0.
//    There is no UserAchievement table. The unlock record IS the
//    XpTransaction row (source = ACHIEVEMENT, sourceKey = achievement:{key}),
//    whose uniqueness makes an unlock once-only and whose createdAt IS the
//    unlockedAt. A 0-XP achievement would write no row and be invisible. If a
//    future badge genuinely must be worth nothing, that is the moment to add
//    the table back — not the moment to relax this rule.
//
// 2. EVERY PREDICATE READS ONLY THE SNAPSHOT.
//    AchievementSnapshot is built by a FIXED set of queries (see
//    GamificationService), so the profile endpoint's cost does not grow with
//    the catalog. A badge needing new data adds a FIELD TO THE SNAPSHOT, never
//    a query of its own. A predicate that reaches for Prisma reintroduces
//    exactly the per-achievement N+1 this shape exists to prevent.
//
// ACHIEVEMENTS ARE NEVER REVOKED. The ledger is append-only and has no delete
// path, so an unlock is permanent even if the underlying count later falls
// (an admin unpublishing a course, a mastered word lapsing). That is the
// intended product behaviour — a badge records something the student did, not
// a state they must maintain.

/** Everything every predicate is allowed to look at. */
export interface AchievementSnapshot {
  /**
   * Stages finished across every module, all-time — video, theory, quiz and
   * practice together. Same definition of "stage" the dashboard uses
   * (DashboardAnalyticsService sums step completions and task completions),
   * so the two surfaces cannot disagree about what counts.
   */
  stagesCompleted: number;
  /** Quiz tasks passed, all-time. Practice is excluded on purpose — see FIRST_QUIZ_PASS. */
  quizTasksPassed: number;
  /** Words that have ever reached MASTERED and still hold it. */
  wordsMastered: number;
  /** Lifetime XP — the ledger total, i.e. User.totalPoints. */
  totalXp: number;
  /**
   * The student's current day streak.
   *
   * Supplied by the caller rather than computed here, and it is the ONE field
   * that is not always available: the profile read does not compute a streak
   * (that number lives in exactly one place, Sprint 09's dashboard widget), so
   * it passes `null`. Streak predicates then report "not unlocked yet" from
   * the stored ledger instead of re-deriving. Only the write path — which has
   * just computed the streak in order to decide whether a new day started —
   * passes a number.
   */
  currentStreakDays: number | null;
}

export interface AchievementDefinition {
  key: AchievementKey;
  /** XP granted on unlock. MUST be > 0 — see the header. */
  xp: number;
  /** True when the student has earned it. Pure, snapshot-only. */
  isEarned: (snapshot: AchievementSnapshot) => boolean;
  /**
   * Progress toward an unearned badge, or null when it cannot be shown.
   *
   * Streak badges return null deliberately: a progress bar would need the
   * current streak, and the profile endpoint does not carry one.
   */
  progress: (
    snapshot: AchievementSnapshot,
  ) => { current: number; target: number } | null;
}

export type AchievementKey =
  | 'FIRST_STAGE'
  | 'FIRST_QUIZ_PASS'
  | 'FIRST_MASTERED_WORD'
  | 'STREAK_3'
  | 'STREAK_7'
  | 'XP_500';

// A counting badge: "reach N of something". Extracted because five of the six
// are this shape, and writing the clamp out five times is five chances to
// forget it.
const counter = (
  key: AchievementKey,
  xp: number,
  target: number,
  read: (snapshot: AchievementSnapshot) => number,
): AchievementDefinition => ({
  key,
  xp,
  isEarned: (snapshot) => read(snapshot) >= target,
  // Clamped so a student past the target never renders 7/1 on a bar. The
  // unlocked case does not use this at all, but a badge can be earned and its
  // progress asked for in the same response.
  progress: (snapshot) => ({
    current: Math.min(read(snapshot), target),
    target,
  }),
});

// A streak badge. Unearned progress is null — see AchievementSnapshot.
const streak = (
  key: AchievementKey,
  xp: number,
  days: number,
): AchievementDefinition => ({
  key,
  xp,
  isEarned: (snapshot) =>
    snapshot.currentStreakDays !== null && snapshot.currentStreakDays >= days,
  progress: () => null,
});

/**
 * THE CATALOG. Six entries, closed for Sprint 10.
 *
 * ⚠️ ADDING A SECOND XP-THRESHOLD BADGE NEEDS A CODE CHANGE ELSEWHERE.
 * GamificationService evaluates achievements ONCE after awarding an action's
 * XP, then awards any unlocked badges in a single second pass and stops. That
 * is sound only while at most one badge depends on totalXp: today XP_500 can
 * be pushed over by an action, but its own 100 XP cannot unlock anything else.
 * Add XP_1000 and that stops being true — a bounded loop (at most
 * ACHIEVEMENTS.length passes) becomes necessary.
 */
export const ACHIEVEMENTS: readonly AchievementDefinition[] = [
  counter('FIRST_STAGE', 20, 1, (s) => s.stagesCompleted),
  // Quiz only, not "any task": Advanced Practice is gated behind the quiz, so
  // crediting a practice pass here would name something the student cannot
  // have reached first. Keeping the predicate literal also means the badge
  // still says what it says if that gating is ever relaxed.
  counter('FIRST_QUIZ_PASS', 20, 1, (s) => s.quizTasksPassed),
  counter('FIRST_MASTERED_WORD', 20, 1, (s) => s.wordsMastered),
  streak('STREAK_3', 25, 3),
  streak('STREAK_7', 60, 7),
  counter('XP_500', 100, 500, (s) => s.totalXp),
];

export interface EvaluatedAchievement {
  key: AchievementKey;
  xp: number;
  /** ISO timestamp of the unlocking ledger row, or null when still locked. */
  unlockedAt: string | null;
  progress: { current: number; target: number } | null;
}

/**
 * The whole catalog, resolved against one snapshot and the set already
 * unlocked. Pure — ZERO queries, whatever the catalog's size.
 *
 * Already-unlocked badges keep their recorded timestamp and are never
 * re-evaluated: an unlock is permanent (see the header), so a count that has
 * since fallen must not take a badge away.
 */
export const evaluateAchievements = (
  snapshot: AchievementSnapshot,
  unlockedAt: ReadonlyMap<string, Date>,
): EvaluatedAchievement[] =>
  ACHIEVEMENTS.map((definition) => {
    const unlocked = unlockedAt.get(definition.key);
    return {
      key: definition.key,
      xp: definition.xp,
      unlockedAt: unlocked ? unlocked.toISOString() : null,
      progress: unlocked ? null : definition.progress(snapshot),
    };
  });

/**
 * Badges the student has just earned but does not hold yet.
 *
 * The write path's question. Returns definitions rather than keys so the
 * caller can build ledger rows without looking anything up again.
 */
export const newlyEarnedAchievements = (
  snapshot: AchievementSnapshot,
  alreadyUnlocked: ReadonlySet<string>,
): AchievementDefinition[] =>
  ACHIEVEMENTS.filter(
    (definition) =>
      !alreadyUnlocked.has(definition.key) && definition.isEarned(snapshot),
  );
