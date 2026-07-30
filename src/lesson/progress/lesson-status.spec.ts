import { LessonStepsDto } from '../steps/lesson-step.types';
import {
  availableStages,
  deriveCourseSummary,
  deriveLessonStatus,
  lessonHasTheory,
  LessonStatusInput,
  LessonStatusRow,
} from './lesson-status';

// Sprint 08 — the canonical completion rules, tested without a database
// because they are pure.

// --- Fixtures ---------------------------------------------------------------

const step = (
  overrides: { startedAt?: string | null; completedAt?: string | null } = {},
) => ({
  step: 'VIDEO' as never,
  startedAt: overrides.startedAt ?? null,
  completedAt: overrides.completedAt ?? null,
  lastActivityAt: '2026-07-30T00:00:00.000Z',
  highestPositionSeconds: null,
  videoDurationSeconds: null,
});

const NO_STEPS: LessonStepsDto = { video: null, theory: null };

const lesson = (
  overrides: Partial<LessonStatusInput> = {},
): LessonStatusInput => ({
  videoUrl: null,
  notes: null,
  steps: NO_STEPS,
  quiz: null,
  trapHunter: null,
  practice: null,
  ...overrides,
});

// --- hasTheory --------------------------------------------------------------

describe('lessonHasTheory', () => {
  // THE SHARED FIXTURE TABLE.
  //
  // An identical table lives in the frontend at
  // services/lessonProgress.test.ts, because services/lessonProgress.ts still
  // derives per-stage status for the lesson stepper. Change one, change both:
  // if the two disagree about whether a lesson HAS theory, the course page and
  // the lesson page disagree about whether that lesson is finished — which is
  // precisely the class of bug Sprint 07 was called in to fix.
  const cases: [string, string | null, boolean][] = [
    ['null notes', null, false],
    ['empty notes', '', false],
    ['whitespace only', '   \n  \t ', false],
    ['plain text, no heading', 'Just some prose.', true],
    // A trim check would say true here. parseGrammarNotes strips tags first,
    // leaving nothing, so the student would see an empty theory pane.
    ['HTML-only notes', '<p></p>', false],
    ['HTML wrapping real text', '<p>Real content</p>', true],
    // A heading with no body yields no section and no fallback. A trim check
    // would say true and create a stage with nothing in it to complete.
    ['heading with no body', '## Heading', false],
    ['heading with blank body', '## Heading\n\n   \n', false],
    ['heading with body', '## Heading\nSome body text.', true],
    ['heading with HTML-only body', '## Heading\n<span></span>', false],
    ['text before the first heading', 'Intro text\n## Heading', true],
    ['two headings, second has the body', '## A\n\n## B\nbody', true],
    ['heading-like line that is not a heading', '##NoSpace', true],
  ];

  it.each(cases)('%s', (_name, notes, expected) => {
    expect(lessonHasTheory(notes)).toBe(expected);
  });
});

// --- availableStages --------------------------------------------------------

describe('availableStages', () => {
  it('is empty for a lesson with no video, notes or tasks', () => {
    expect(availableStages(lesson())).toEqual([]);
  });

  it('lists every stage the lesson actually offers', () => {
    expect(
      availableStages(
        lesson({
          videoUrl: 'https://youtu.be/abc',
          notes: '## A\nbody',
          quiz: { passed: true, attemptsCount: 1 },
          trapHunter: { hasSource: true, total: 2, cleared: 0 },
          practice: { passed: false, attemptsCount: 0 },
        }),
      ),
    ).toEqual(['video', 'theory', 'quiz', 'traphunter', 'practice']);
  });

  it('omits trap hunter when a perfect quiz produced no traps', () => {
    // Otherwise scoring 100% would leave behind a stage that can never be
    // completed, freezing the lesson below 100% as a reward for full marks.
    expect(
      availableStages(
        lesson({
          quiz: { passed: true, attemptsCount: 1 },
          trapHunter: { hasSource: true, total: 0, cleared: 0 },
        }),
      ),
    ).toEqual(['quiz']);
  });

  it('omits trap hunter when no completed attempt exists to derive traps from', () => {
    expect(
      availableStages(
        lesson({
          quiz: { passed: false, attemptsCount: 0 },
          trapHunter: { hasSource: false, total: 0, cleared: 0 },
        }),
      ),
    ).toEqual(['quiz']);
  });

  it('treats a blank videoUrl as no video', () => {
    expect(availableStages(lesson({ videoUrl: '   ' }))).toEqual([]);
  });
});

// --- deriveLessonStatus -----------------------------------------------------

describe('deriveLessonStatus', () => {
  it('reports NO_CONTENT for a published lesson with zero completable stages', () => {
    // The audio-only lesson. LessonService.publish accepts a lesson carrying
    // only audioUrl, and no audio stage exists — so without NO_CONTENT this
    // lesson would sit at NOT_STARTED forever and its course could never
    // reach 100%.
    expect(deriveLessonStatus(lesson())).toBe('NO_CONTENT');
  });

  it('is NOT_STARTED when stages exist but none is touched', () => {
    expect(
      deriveLessonStatus(lesson({ videoUrl: 'https://youtu.be/abc' })),
    ).toBe('NOT_STARTED');
  });

  it('is IN_PROGRESS once any stage is started', () => {
    expect(
      deriveLessonStatus(
        lesson({
          videoUrl: 'https://youtu.be/abc',
          notes: '## A\nbody',
          steps: {
            video: step({ startedAt: '2026-07-30T00:00:00.000Z' }),
            theory: null,
          },
        }),
      ),
    ).toBe('IN_PROGRESS');
  });

  it('is IN_PROGRESS when one of two stages is complete', () => {
    expect(
      deriveLessonStatus(
        lesson({
          videoUrl: 'https://youtu.be/abc',
          notes: '## A\nbody',
          steps: {
            video: step({
              startedAt: '2026-07-30T00:00:00.000Z',
              completedAt: '2026-07-30T00:10:00.000Z',
            }),
            theory: null,
          },
        }),
      ),
    ).toBe('IN_PROGRESS');
  });

  it('is COMPLETED only when every available stage is complete', () => {
    expect(
      deriveLessonStatus(
        lesson({
          videoUrl: 'https://youtu.be/abc',
          notes: '## A\nbody',
          steps: {
            video: step({ completedAt: '2026-07-30T00:10:00.000Z' }),
            theory: step({ completedAt: '2026-07-30T00:20:00.000Z' }),
          },
          quiz: { passed: true, attemptsCount: 2 },
          trapHunter: { hasSource: true, total: 3, cleared: 3 },
          practice: { passed: true, attemptsCount: 1 },
        }),
      ),
    ).toBe('COMPLETED');
  });

  it('a lesson with no quiz can still be COMPLETED', () => {
    // A missing task must never create a requirement that cannot be satisfied.
    expect(
      deriveLessonStatus(
        lesson({
          videoUrl: 'https://youtu.be/abc',
          steps: {
            video: step({ completedAt: '2026-07-30T00:10:00.000Z' }),
            theory: null,
          },
        }),
      ),
    ).toBe('COMPLETED');
  });

  it('outstanding traps hold the lesson at IN_PROGRESS', () => {
    expect(
      deriveLessonStatus(
        lesson({
          quiz: { passed: true, attemptsCount: 1 },
          trapHunter: { hasSource: true, total: 3, cleared: 1 },
        }),
      ),
    ).toBe('IN_PROGRESS');
  });

  it('a passed quiz with zero traps completes the lesson', () => {
    expect(
      deriveLessonStatus(
        lesson({
          quiz: { passed: true, attemptsCount: 1 },
          trapHunter: { hasSource: true, total: 0, cleared: 0 },
        }),
      ),
    ).toBe('COMPLETED');
  });

  it('an unpassed quiz with attempts is IN_PROGRESS, not NOT_STARTED', () => {
    expect(
      deriveLessonStatus(lesson({ quiz: { passed: false, attemptsCount: 1 } })),
    ).toBe('IN_PROGRESS');
  });

  it('a theory-only lesson needs the explicit read to complete', () => {
    const notes = '## A\nbody';
    expect(deriveLessonStatus(lesson({ notes }))).toBe('NOT_STARTED');
    expect(
      deriveLessonStatus(
        lesson({
          notes,
          steps: {
            video: null,
            theory: step({ startedAt: '2026-07-30T00:00:00.000Z' }),
          },
        }),
      ),
    ).toBe('IN_PROGRESS');
    expect(
      deriveLessonStatus(
        lesson({
          notes,
          steps: {
            video: null,
            theory: step({ completedAt: '2026-07-30T00:00:00.000Z' }),
          },
        }),
      ),
    ).toBe('COMPLETED');
  });
});

// --- deriveCourseSummary ----------------------------------------------------

describe('deriveCourseSummary', () => {
  const row = (
    lessonId: string,
    orderIndex: number,
    status: LessonStatusRow['status'],
  ): LessonStatusRow => ({ lessonId, orderIndex, status });

  it('reports zeroes and no continuation for a course with no lessons', () => {
    expect(deriveCourseSummary([])).toEqual({
      totalLessons: 0,
      completedLessons: 0,
      inProgressLessons: 0,
      notStartedLessons: 0,
      progressPercent: 0,
      status: 'NOT_STARTED',
      continueLessonId: null,
    });
  });

  it('floors the percentage rather than rounding', () => {
    // 1/3 is 33.3%. Rounding up would let a single finished lesson out of
    // twenty look like more than it is.
    const summary = deriveCourseSummary([
      row('a', 0, 'COMPLETED'),
      row('b', 1, 'NOT_STARTED'),
      row('c', 2, 'NOT_STARTED'),
    ]);
    expect(summary.progressPercent).toBe(33);
  });

  it('reports 100 and COMPLETED only when every countable lesson is done', () => {
    const summary = deriveCourseSummary([
      row('a', 0, 'COMPLETED'),
      row('b', 1, 'COMPLETED'),
    ]);
    expect(summary.progressPercent).toBe(100);
    expect(summary.status).toBe('COMPLETED');
  });

  it('excludes NO_CONTENT lessons from both numerator and denominator', () => {
    // The whole point of the fourth status: a course holding two audio-only
    // lessons must still be able to reach 100%.
    const summary = deriveCourseSummary([
      row('a', 0, 'COMPLETED'),
      row('b', 1, 'NO_CONTENT'),
      row('c', 2, 'COMPLETED'),
      row('d', 3, 'NO_CONTENT'),
    ]);
    expect(summary.totalLessons).toBe(2);
    expect(summary.completedLessons).toBe(2);
    expect(summary.progressPercent).toBe(100);
    expect(summary.status).toBe('COMPLETED');
  });

  it('is IN_PROGRESS when nothing is finished but something is started', () => {
    // The case a percent-driven CTA gets wrong: 0% but the student has a place
    // to return to, so the button must read "Học tiếp", not "Bắt đầu".
    const summary = deriveCourseSummary([
      row('a', 0, 'IN_PROGRESS'),
      row('b', 1, 'NOT_STARTED'),
    ]);
    expect(summary.progressPercent).toBe(0);
    expect(summary.status).toBe('IN_PROGRESS');
  });

  it('counts each bucket and leaves no lesson unaccounted for', () => {
    const summary = deriveCourseSummary([
      row('a', 0, 'COMPLETED'),
      row('b', 1, 'IN_PROGRESS'),
      row('c', 2, 'NOT_STARTED'),
      row('d', 3, 'NOT_STARTED'),
    ]);
    expect(summary).toMatchObject({
      totalLessons: 4,
      completedLessons: 1,
      inProgressLessons: 1,
      notStartedLessons: 2,
    });
  });

  it('drops back to IN_PROGRESS when a new lesson is published after 100%', () => {
    const summary = deriveCourseSummary([
      row('a', 0, 'COMPLETED'),
      row('b', 1, 'COMPLETED'),
      row('new', 2, 'NOT_STARTED'),
    ]);
    expect(summary.progressPercent).toBe(66);
    expect(summary.status).toBe('IN_PROGRESS');
    expect(summary.continueLessonId).toBe('new');
  });

  describe('continueLessonId', () => {
    it('prefers the earliest IN_PROGRESS lesson by orderIndex', () => {
      const summary = deriveCourseSummary([
        row('third', 2, 'IN_PROGRESS'),
        row('first', 0, 'COMPLETED'),
        row('second', 1, 'IN_PROGRESS'),
      ]);
      expect(summary.continueLessonId).toBe('second');
    });

    it('falls back to the earliest NOT_STARTED lesson', () => {
      const summary = deriveCourseSummary([
        row('b', 1, 'NOT_STARTED'),
        row('a', 0, 'COMPLETED'),
        row('c', 2, 'NOT_STARTED'),
      ]);
      expect(summary.continueLessonId).toBe('b');
    });

    it('points at the first lesson once the course is complete, for review', () => {
      const summary = deriveCourseSummary([
        row('b', 1, 'COMPLETED'),
        row('a', 0, 'COMPLETED'),
      ]);
      expect(summary.continueLessonId).toBe('a');
    });

    it('skips NO_CONTENT lessons entirely', () => {
      const summary = deriveCourseSummary([
        row('audio', 0, 'NO_CONTENT'),
        row('real', 1, 'NOT_STARTED'),
      ]);
      expect(summary.continueLessonId).toBe('real');
    });

    it('is null when no countable lesson exists', () => {
      expect(
        deriveCourseSummary([row('audio', 0, 'NO_CONTENT')]).continueLessonId,
      ).toBeNull();
    });
  });
});
