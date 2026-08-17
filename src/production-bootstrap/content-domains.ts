// Phase 7 — Production Data Bootstrap. The approved, hardcoded allowlist of
// admin-authored learning content models, grouped into the four content
// domains the bootstrap script transacts independently (one transaction per
// domain, not per model — a failure in one domain must not roll back an
// already-committed sibling domain).
//
// This list was derived by inspecting every model in prisma/schema.prisma,
// not by re-copying an older audit. Two candidates were deliberately
// excluded: `Vocabulary` and `LessonVocabulary` are dormant/superseded (see
// docs/memory.md) — schema-only, never read or written by any live code
// path. Achievements were also considered and excluded: they are pure code
// (src/gamification/achievement-catalog.ts), not a Prisma model — there is
// no DB row to bootstrap for them.

export type DomainName = 'grammar' | 'vocabulary' | 'listening' | 'placement';

export interface ForeignKeyRef {
  readonly field: string;
  readonly referencesModel: string;
}

export interface ContentModelDefinition {
  /** Prisma schema model name (PascalCase), e.g. "Course". */
  readonly name: string;
  /** Prisma client delegate property name (camelCase), e.g. "course". */
  readonly delegate: string;
  readonly domain: DomainName;
  /** Used for FK-orphan verification only — insert order is the array order below. */
  readonly foreignKeys: readonly ForeignKeyRef[];
}

// Order within each domain is parent-before-child — this IS the insert order
// used by the bootstrap script, not just documentation.
export const CONTENT_MODELS: readonly ContentModelDefinition[] = [
  // Grammar
  { name: 'Course', delegate: 'course', domain: 'grammar', foreignKeys: [] },
  {
    name: 'Lesson',
    delegate: 'lesson',
    domain: 'grammar',
    foreignKeys: [{ field: 'courseId', referencesModel: 'Course' }],
  },
  {
    name: 'LessonTask',
    delegate: 'lessonTask',
    domain: 'grammar',
    foreignKeys: [{ field: 'lessonId', referencesModel: 'Lesson' }],
  },
  {
    name: 'Question',
    delegate: 'question',
    domain: 'grammar',
    foreignKeys: [{ field: 'taskId', referencesModel: 'LessonTask' }],
  },
  // Vocabulary
  {
    name: 'VocabLibrary',
    delegate: 'vocabLibrary',
    domain: 'vocabulary',
    foreignKeys: [],
  },
  {
    name: 'VocabDeck',
    delegate: 'vocabDeck',
    domain: 'vocabulary',
    foreignKeys: [{ field: 'libraryId', referencesModel: 'VocabLibrary' }],
  },
  { name: 'VocabWord', delegate: 'vocabWord', domain: 'vocabulary', foreignKeys: [] },
  {
    name: 'VocabWordMeaning',
    delegate: 'vocabWordMeaning',
    domain: 'vocabulary',
    foreignKeys: [{ field: 'wordId', referencesModel: 'VocabWord' }],
  },
  {
    name: 'VocabWordExample',
    delegate: 'vocabWordExample',
    domain: 'vocabulary',
    foreignKeys: [{ field: 'wordId', referencesModel: 'VocabWord' }],
  },
  {
    name: 'VocabDeckWord',
    delegate: 'vocabDeckWord',
    domain: 'vocabulary',
    foreignKeys: [
      { field: 'deckId', referencesModel: 'VocabDeck' },
      { field: 'wordId', referencesModel: 'VocabWord' },
    ],
  },
  // Listening
  {
    name: 'ListeningCategory',
    delegate: 'listeningCategory',
    domain: 'listening',
    foreignKeys: [],
  },
  {
    name: 'ListeningContent',
    delegate: 'listeningContent',
    domain: 'listening',
    foreignKeys: [{ field: 'categoryId', referencesModel: 'ListeningCategory' }],
  },
  {
    name: 'ListeningSegment',
    delegate: 'listeningSegment',
    domain: 'listening',
    foreignKeys: [{ field: 'contentId', referencesModel: 'ListeningContent' }],
  },
  // Placement
  {
    name: 'PlacementQuestion',
    delegate: 'placementQuestion',
    domain: 'placement',
    foreignKeys: [],
  },
];

export const DOMAIN_ORDER: readonly DomainName[] = [
  'grammar',
  'vocabulary',
  'listening',
  'placement',
];

export const modelsForDomain = (
  domain: DomainName,
): readonly ContentModelDefinition[] =>
  CONTENT_MODELS.filter((model) => model.domain === domain);

// Defense-in-depth: every model this bootstrap tool must NEVER touch,
// checked against CONTENT_MODELS below at import time. This is not the
// primary safety mechanism (the primary one is that no code path here ever
// references these delegates at all) — it is a second, independent
// tripwire against a future edit mistake.
const EXCLUDED_MODEL_NAMES: ReadonlySet<string> = new Set([
  'User',
  'AuthIdentity',
  'EmailVerificationToken',
  'PasswordResetToken',
  'LessonStepProgress',
  'LessonTaskProgress',
  'LessonTaskAttempt',
  'VocabGuessProgress',
  'UserWordProgress',
  'WordReviewLog',
  'XpTransaction',
  'UserDailyActivity',
  'StudyTimeEvent',
  'ListeningDictationSegmentProgress',
  'ListeningDictationAttempt',
  'ListeningShadowingSegmentProgress',
  'ListeningShadowingAttempt',
  'PlacementAttempt',
  'PlacementAnswer',
  'Roadmap',
  'Vocabulary',
  'LessonVocabulary',
]);

export const assertAllowlistExcludesUserData = (
  models: readonly ContentModelDefinition[] = CONTENT_MODELS,
): void => {
  const overlap = models.filter((model) => EXCLUDED_MODEL_NAMES.has(model.name));
  if (overlap.length > 0) {
    throw new Error(
      `CONTENT_MODELS accidentally includes excluded model(s): ${overlap
        .map((model) => model.name)
        .join(', ')}`,
    );
  }
};

// Runs once on import, so any code path that imports this module (the
// orchestrator script, tests, anything else) gets the tripwire for free.
assertAllowlistExcludesUserData();
