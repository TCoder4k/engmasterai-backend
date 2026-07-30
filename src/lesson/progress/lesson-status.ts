import { LessonStepsDto } from '../steps/lesson-step.types';

// Sprint 08 — the canonical, SERVER-SIDE definition of lesson and course
// completion. Pure: no Prisma, no I/O, no dates read from the clock.
//
// WHY THIS FILE EXISTS
// Until now the only definition of "is this lesson finished" lived in the
// frontend's services/lessonProgress.ts. Sprint 07 made every INPUT
// server-authoritative but left the RULE on the client, so a course percentage
// was still something the browser decided. This file is that rule, moved.
//
// INVARIANT A, RELOCATED — LESSON COMPLETION IS STAGE-DRIVEN AND DYNAMIC.
// deriveLessonStatus asks `availableStages(...).every(completed)` and must keep
// asking exactly that. It must never become a hardcoded conjunction such as:
//
//     theoryCompleted && quizPassed && trapsCleared        // FORBIDDEN
//
// Each stage is one more entry in a list. That property is why Sprint 06D
// widened completion to Advanced Practice and Sprint 07 moved two stages onto
// the server, both with zero changes to the rule's body. The invariant followed
// the rule here; it did not stay behind.
//
// EQUIVALENCE WITH THE CLIENT
// services/lessonProgress.ts still derives PER-STAGE status for the lesson
// stepper, so two implementations of the stage rules exist until the client
// copy is retired. They are pinned by an identical fixture table:
//   backend : src/lesson/progress/lesson-status.spec.ts
//   frontend: services/lessonProgress.test.ts
// Change one, change both, or the course page and the lesson page start
// disagreeing about the same lesson — the exact bug Sprint 07 was called in to
// fix.

export type LessonStageId =
  | 'video'
  | 'theory'
  | 'quiz'
  | 'traphunter'
  | 'practice';

// NO_CONTENT is a FOURTH value, beyond the three the product brief names, and
// it is load-bearing.
//
// LessonService.publish accepts a lesson carrying only `audioUrl`, and there is
// no audio stage anywhere — `lesson.audioUrl` is rendered by no student
// component at all. Such a lesson offers zero completable stages, so under the
// three-status model it would sit at NOT_STARTED forever, `completed === total`
// would be unreachable, and the course could never report COMPLETED or show
// "Ôn tập lại". The three-status contract silently assumed every published
// lesson is completable; this is the value that says otherwise out loud.
//
// A boolean flag beside NOT_STARTED was rejected: the row still has to render
// something, and "not started" is a false claim about a lesson the student was
// never able to begin.
export type LessonStatus =
  | 'NOT_STARTED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'NO_CONTENT';

export type CourseStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';

export interface StageProgressInput {
  quiz: { passed: boolean; attemptsCount: number } | null;
  trapHunter: { hasSource: boolean; total: number; cleared: number } | null;
  practice: { passed: boolean; attemptsCount: number } | null;
}

export interface LessonStatusInput extends StageProgressInput {
  videoUrl: string | null;
  notes: string | null;
  steps: LessonStepsDto;
}

// --- What a lesson actually offers ------------------------------------------

export const lessonHasVideo = (videoUrl: string | null): boolean =>
  Boolean(videoUrl && videoUrl.trim());

// A STRUCTURAL PORT of the frontend's parseGrammarNotes + lessonHasTheory,
// deliberately kept line-comparable to it rather than simplified.
//
// `notes.trim() !== ''` is NOT equivalent and would disagree on real content:
//   '## Heading'  -> a heading with no body yields no section and no fallback,
//                    so the frontend renders nothing and reports FALSE, while a
//                    trim check reports true.
//   '<p></p>'     -> sanitizes to empty, so the frontend reports FALSE too.
// Both cases would create a theory stage the student can see no content for and
// therefore can never complete — a lesson stuck below 100% with nothing on
// screen to do about it.
export const lessonHasTheory = (notes: string | null): boolean => {
  if (!notes || !notes.trim()) return false;

  const stripHtml = (text: string): string => text.replace(/<[^>]*>/g, '');
  const HEADING_LINE_RE = /^##\s+(.+?)\s*$/;

  const leading: string[] = [];
  let currentHeading: string | null = null;
  let currentBody: string[] = [];
  let sawHeading = false;
  let hasSection = false;

  // Mirrors parseGrammarNotes' flush(): a heading whose body sanitizes to
  // empty contributes no section at all.
  const flush = (): void => {
    if (currentHeading === null) return;
    if (stripHtml(currentBody.join('\n')).trim()) hasSection = true;
  };

  for (const line of notes.split('\n')) {
    if (HEADING_LINE_RE.test(line)) {
      flush();
      currentHeading = line.replace(HEADING_LINE_RE, '$1').trim();
      currentBody = [];
      sawHeading = true;
    } else if (currentHeading === null) {
      leading.push(line);
    } else {
      currentBody.push(line);
    }
  }
  flush();

  // No headings at all: the whole text becomes fallbackText, and the frontend
  // reports true only when that text survives tag-stripping.
  if (!sawHeading) return Boolean(stripHtml(notes).trim());

  // Content before the first heading is kept as a leading, unheaded section
  // rather than dropped, so it counts.
  return hasSection || Boolean(stripHtml(leading.join('\n')).trim());
};

// --- Which stages this lesson actually has ----------------------------------

// A published QUIZ/PRACTICE task existing is signalled by the collector row
// being present at all — the aggregate builds these rows from
// `lessonTask.findMany({ isPublished: true })`, so a null means "no such
// published task on this lesson", never "not started".
export const availableStages = (
  input: Pick<
    LessonStatusInput,
    'videoUrl' | 'notes' | 'quiz' | 'trapHunter' | 'practice'
  >,
): LessonStageId[] => {
  const stages: LessonStageId[] = [];
  if (lessonHasVideo(input.videoUrl)) stages.push('video');
  if (lessonHasTheory(input.notes)) stages.push('theory');
  if (input.quiz) stages.push('quiz');
  // Trap Hunter becomes a requirement only once an attempt has actually
  // produced traps. A perfect quiz must not leave behind a stage that can never
  // be completed, which would freeze the lesson below 100% as a reward for
  // scoring full marks.
  if (input.quiz && input.trapHunter?.hasSource && input.trapHunter.total > 0) {
    stages.push('traphunter');
  }
  if (input.practice) stages.push('practice');
  return stages;
};

// --- Per-stage completion ---------------------------------------------------

const isStageCompleted = (
  stage: LessonStageId,
  input: LessonStatusInput,
): boolean => {
  switch (stage) {
    case 'video':
      return input.steps.video?.completedAt != null;
    case 'theory':
      return input.steps.theory?.completedAt != null;
    case 'quiz':
      return input.quiz?.passed === true;
    case 'traphunter':
      return (
        input.trapHunter != null &&
        input.trapHunter.total > 0 &&
        input.trapHunter.cleared >= input.trapHunter.total
      );
    case 'practice':
      return input.practice?.passed === true;
  }
};

// "Touched" — the input to IN_PROGRESS. A blocked Advanced Practice stage with
// no attempts is NOT touched, matching the client, where 'blocked' is neither
// in_progress nor completed.
const isStageStarted = (
  stage: LessonStageId,
  input: LessonStatusInput,
): boolean => {
  switch (stage) {
    case 'video':
      return input.steps.video?.startedAt != null;
    case 'theory':
      return input.steps.theory?.startedAt != null;
    case 'quiz':
      return (input.quiz?.attemptsCount ?? 0) > 0;
    case 'traphunter':
      return (input.trapHunter?.cleared ?? 0) > 0;
    case 'practice':
      return (input.practice?.attemptsCount ?? 0) > 0;
  }
};

// --- Lesson status ----------------------------------------------------------

export const deriveLessonStatus = (input: LessonStatusInput): LessonStatus => {
  const stages = availableStages(input);
  if (stages.length === 0) return 'NO_CONTENT';

  // INVARIANT A. Keep this an .every() over a computed list.
  if (stages.every((stage) => isStageCompleted(stage, input)))
    return 'COMPLETED';

  const touched = stages.some(
    (stage) => isStageCompleted(stage, input) || isStageStarted(stage, input),
  );
  return touched ? 'IN_PROGRESS' : 'NOT_STARTED';
};

// --- Course rollup ----------------------------------------------------------

export interface LessonStatusRow {
  lessonId: string;
  orderIndex: number;
  status: LessonStatus;
}

export interface CourseSummary {
  totalLessons: number;
  completedLessons: number;
  inProgressLessons: number;
  notStartedLessons: number;
  progressPercent: number;
  status: CourseStatus;
  continueLessonId: string | null;
}

// NO_CONTENT lessons are excluded from BOTH numerator and denominator. Counting
// them in the denominator would make 100% unreachable for any course holding
// one; counting them as complete would credit a student for a lesson they never
// opened. Excluding them says the honest thing: there is nothing here to finish.
//
// A consequence worth knowing: a course can RISE toward 100% when an admin
// removes the last stage from a lesson. That is correct — the requirement was
// withdrawn, not satisfied.
export const deriveCourseSummary = (rows: LessonStatusRow[]): CourseSummary => {
  const countable = rows
    .filter((row) => row.status !== 'NO_CONTENT')
    .sort((a, b) => a.orderIndex - b.orderIndex);

  const totalLessons = countable.length;
  const completedLessons = countable.filter(
    (row) => row.status === 'COMPLETED',
  ).length;
  const inProgressLessons = countable.filter(
    (row) => row.status === 'IN_PROGRESS',
  ).length;

  // floor, matching the Learning Engine's percentages (ADR 007 §5) and the
  // client function this replaces: one finished lesson out of twenty must not
  // round up to look like more, and only a genuine 100% ever shows 100.
  const progressPercent =
    totalLessons === 0
      ? 0
      : Math.floor((completedLessons / totalLessons) * 100);

  const status: CourseStatus =
    totalLessons > 0 && completedLessons === totalLessons
      ? 'COMPLETED'
      : completedLessons > 0 || inProgressLessons > 0
        ? 'IN_PROGRESS'
        : 'NOT_STARTED';

  return {
    totalLessons,
    completedLessons,
    inProgressLessons,
    notStartedLessons: totalLessons - completedLessons - inProgressLessons,
    progressPercent,
    status,
    continueLessonId: resolveContinueLesson(countable),
  };
};

// Where "Học tiếp" goes. `countable` must already be sorted by orderIndex.
//
// Returns an ID only — never a path. No endpoint in this backend emits a
// frontend route, and starting now would make a React Router change require a
// backend redeploy. The client composes /courses/:courseId/lessons/:lessonId,
// as it already does for Continue Learning and every lesson row.
const resolveContinueLesson = (countable: LessonStatusRow[]): string | null => {
  const inProgress = countable.find((row) => row.status === 'IN_PROGRESS');
  if (inProgress) return inProgress.lessonId;

  const notStarted = countable.find((row) => row.status === 'NOT_STARTED');
  if (notStarted) return notStarted.lessonId;

  // Everything done (or nothing countable): the first lesson, for "Ôn tập lại".
  return countable[0]?.lessonId ?? null;
};
