import {
  ACHIEVEMENTS,
  AchievementSnapshot,
  evaluateAchievements,
  newlyEarnedAchievements,
} from './achievement-catalog';

const EMPTY: AchievementSnapshot = {
  stagesCompleted: 0,
  quizTasksPassed: 0,
  wordsMastered: 0,
  totalXp: 0,
  currentStreakDays: null,
};

const snapshot = (
  overrides: Partial<AchievementSnapshot>,
): AchievementSnapshot => ({
  ...EMPTY,
  ...overrides,
});

const definitionFor = (key: string) => {
  const found = ACHIEVEMENTS.find((a) => a.key === key);
  if (!found) throw new Error(`No achievement ${key} in the catalog`);
  return found;
};

describe('the catalog itself', () => {
  it('holds exactly the six achievements approved for Sprint 10', () => {
    // "Do not add more achievements in Sprint 10" as a failing test rather
    // than a comment. A seventh entry turns this red.
    expect(ACHIEVEMENTS.map((a) => a.key)).toEqual([
      'FIRST_STAGE',
      'FIRST_QUIZ_PASS',
      'FIRST_MASTERED_WORD',
      'STREAK_3',
      'STREAK_7',
      'XP_500',
    ]);
  });

  it('grants a POSITIVE xp for every entry', () => {
    // LOAD-BEARING. There is no UserAchievement table: the unlock record is
    // the XpTransaction row itself. A 0-XP achievement would write no row and
    // would be permanently invisible to the profile read. If this ever needs
    // to fail, the table has to come back first.
    for (const definition of ACHIEVEMENTS) {
      expect(definition.xp).toBeGreaterThan(0);
    }
  });

  it('matches the approved XP values', () => {
    expect(Object.fromEntries(ACHIEVEMENTS.map((a) => [a.key, a.xp]))).toEqual({
      FIRST_STAGE: 20,
      FIRST_QUIZ_PASS: 20,
      FIRST_MASTERED_WORD: 20,
      STREAK_3: 25,
      STREAK_7: 60,
      XP_500: 100,
    });
  });

  it('has unique keys', () => {
    expect(new Set(ACHIEVEMENTS.map((a) => a.key)).size).toBe(
      ACHIEVEMENTS.length,
    );
  });

  it('reads ONLY the snapshot — no predicate touches anything else', () => {
    // The property that keeps the profile endpoint at a fixed query count.
    // A predicate reaching for Prisma would throw here, since the snapshot is
    // a plain object with no client on it.
    for (const definition of ACHIEVEMENTS) {
      expect(() => definition.isEarned(EMPTY)).not.toThrow();
      expect(() => definition.progress(EMPTY)).not.toThrow();
    }
  });
});

describe('predicates', () => {
  it('FIRST_STAGE unlocks on the first stage and not before', () => {
    const first = definitionFor('FIRST_STAGE');
    expect(first.isEarned(snapshot({ stagesCompleted: 0 }))).toBe(false);
    expect(first.isEarned(snapshot({ stagesCompleted: 1 }))).toBe(true);
  });

  it('FIRST_QUIZ_PASS counts quiz passes only, not practice', () => {
    // stagesCompleted includes practice; quizTasksPassed must not. A student
    // whose only completions are steps has not passed a quiz.
    const badge = definitionFor('FIRST_QUIZ_PASS');
    expect(
      badge.isEarned(snapshot({ stagesCompleted: 9, quizTasksPassed: 0 })),
    ).toBe(false);
    expect(badge.isEarned(snapshot({ quizTasksPassed: 1 }))).toBe(true);
  });

  it('FIRST_MASTERED_WORD unlocks on the first mastered word', () => {
    const badge = definitionFor('FIRST_MASTERED_WORD');
    expect(badge.isEarned(snapshot({ wordsMastered: 0 }))).toBe(false);
    expect(badge.isEarned(snapshot({ wordsMastered: 1 }))).toBe(true);
  });

  it('XP_500 unlocks exactly at 500, not at 499', () => {
    const badge = definitionFor('XP_500');
    expect(badge.isEarned(snapshot({ totalXp: 499 }))).toBe(false);
    expect(badge.isEarned(snapshot({ totalXp: 500 }))).toBe(true);
    expect(badge.isEarned(snapshot({ totalXp: 12_000 }))).toBe(true);
  });

  it.each([
    ['STREAK_3', 3],
    ['STREAK_7', 7],
  ])('%s unlocks at %i consecutive days', (key, days) => {
    const badge = definitionFor(key);
    expect(badge.isEarned(snapshot({ currentStreakDays: days - 1 }))).toBe(
      false,
    );
    expect(badge.isEarned(snapshot({ currentStreakDays: days }))).toBe(true);
    expect(badge.isEarned(snapshot({ currentStreakDays: days + 5 }))).toBe(
      true,
    );
  });

  it('treats an UNKNOWN streak as not-yet-earned, never as earned', () => {
    // currentStreakDays is null on the read path, which does not compute a
    // streak. Falling the other way would hand out badges on every profile
    // load.
    expect(
      definitionFor('STREAK_3').isEarned(snapshot({ currentStreakDays: null })),
    ).toBe(false);
    expect(
      definitionFor('STREAK_7').isEarned(snapshot({ currentStreakDays: null })),
    ).toBe(false);
  });
});

describe('progress', () => {
  it('reports counting progress toward an unearned badge', () => {
    expect(
      definitionFor('XP_500').progress(snapshot({ totalXp: 240 })),
    ).toEqual({
      current: 240,
      target: 500,
    });
  });

  it('clamps progress so overshooting never renders 7/1', () => {
    expect(
      definitionFor('FIRST_STAGE').progress(snapshot({ stagesCompleted: 7 })),
    ).toEqual({ current: 1, target: 1 });
  });

  it('reports NO progress for streak badges', () => {
    // A streak bar would need the current streak, and the profile endpoint
    // deliberately does not carry one — that number lives in exactly one
    // place, the dashboard widget.
    expect(definitionFor('STREAK_3').progress(snapshot({}))).toBeNull();
    expect(definitionFor('STREAK_7').progress(snapshot({}))).toBeNull();
  });
});

describe('evaluateAchievements', () => {
  it('returns every catalog entry, locked or not', () => {
    const result = evaluateAchievements(EMPTY, new Map());
    expect(result).toHaveLength(6);
    expect(result.every((a) => a.unlockedAt === null)).toBe(true);
  });

  it('carries the recorded unlock timestamp', () => {
    const when = new Date('2026-08-02T10:00:00.000Z');
    const result = evaluateAchievements(
      EMPTY,
      new Map([['FIRST_STAGE', when]]),
    );
    const first = result.find((a) => a.key === 'FIRST_STAGE');
    expect(first?.unlockedAt).toBe('2026-08-02T10:00:00.000Z');
  });

  it('NEVER revokes a badge whose underlying count has since fallen', () => {
    // An admin unpublishing a course drops stagesCompleted back to 0. The
    // badge records something the student did; it is not a state they have to
    // maintain, and the ledger has no delete path anyway.
    const when = new Date('2026-08-02T10:00:00.000Z');
    const result = evaluateAchievements(
      snapshot({ stagesCompleted: 0 }),
      new Map([['FIRST_STAGE', when]]),
    );
    expect(result.find((a) => a.key === 'FIRST_STAGE')?.unlockedAt).toBe(
      '2026-08-02T10:00:00.000Z',
    );
  });

  it('shows no progress bar on an already-unlocked badge', () => {
    const result = evaluateAchievements(
      snapshot({ totalXp: 900 }),
      new Map([['XP_500', new Date()]]),
    );
    expect(result.find((a) => a.key === 'XP_500')?.progress).toBeNull();
  });
});

describe('newlyEarnedAchievements', () => {
  it('returns only badges earned and not yet held', () => {
    const earned = newlyEarnedAchievements(
      snapshot({ stagesCompleted: 1, quizTasksPassed: 1 }),
      new Set(['FIRST_STAGE']),
    );
    expect(earned.map((a) => a.key)).toEqual(['FIRST_QUIZ_PASS']);
  });

  it('returns nothing when everything earned is already held', () => {
    expect(
      newlyEarnedAchievements(
        snapshot({ stagesCompleted: 5 }),
        new Set(['FIRST_STAGE']),
      ),
    ).toEqual([]);
  });

  it('returns nothing for a brand-new account', () => {
    expect(newlyEarnedAchievements(EMPTY, new Set())).toEqual([]);
  });

  it('can return several at once', () => {
    // One action can complete a stage, pass a quiz and cross 500 XP together.
    const earned = newlyEarnedAchievements(
      snapshot({ stagesCompleted: 1, quizTasksPassed: 1, totalXp: 500 }),
      new Set(),
    );
    expect(earned.map((a) => a.key)).toEqual([
      'FIRST_STAGE',
      'FIRST_QUIZ_PASS',
      'XP_500',
    ]);
  });

  it('carries the xp amount, so the caller builds rows without a second lookup', () => {
    const [earned] = newlyEarnedAchievements(
      snapshot({ totalXp: 500 }),
      new Set(['FIRST_STAGE', 'FIRST_QUIZ_PASS', 'FIRST_MASTERED_WORD']),
    );
    expect(earned).toMatchObject({ key: 'XP_500', xp: 100 });
  });
});
