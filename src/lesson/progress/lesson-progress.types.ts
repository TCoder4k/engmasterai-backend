import { LessonStepsDto } from '../steps/lesson-step.types';
import { PracticeAvailabilityDto } from '../quiz/practice.types';
import { CourseStatus, LessonStatus } from './lesson-status';

// Sprint 07 — GET /lessons/:lessonId/progress.
//
// The canonical progress payload for the lesson page. Before this the page
// made four progress-shaped requests (quiz, trap hunter, practice, and nothing
// at all for video/theory, which lived in localStorage) — and it never
// actually made the quiz one, so a passed quiz rendered "Chưa học" in the
// stepper until the student happened to open the quiz tab.
//
// The per-stage endpoints (/quiz, /trap-hunter, /practice) are NOT replaced by
// this and are not deprecated. They carry the full stage payload — questions,
// traps, the in-flight attempt — that a stage component needs to run. This
// carries only what the STEPPER needs to render five tiles.

export interface LessonQuizProgressDto {
  passed: boolean;
  bestScorePercent: number | null;
  attemptsCount: number;
}

export interface LessonTrapProgressDto {
  hasSource: boolean;
  total: number;
  cleared: number;
}

export interface LessonPracticeProgressDto {
  passed: boolean;
  bestScorePercent: number | null;
  attemptsCount: number;
  // Sprint 07 — the server's own answer to "may this student start Practice
  // yet", computed by the same pure resolvePracticePrerequisites() the
  // mutations enforce with.
  //
  // The client used to derive this itself, in a hand-maintained mirror of
  // practice-prerequisites.ts. Two implementations of one rule is a drift
  // waiting to happen, and the frontend copy has now been deleted. Sprint 06D
  // deliberately kept prerequisitesMet OUT of the course payload to avoid a
  // fourth derived boolean that could disagree with the three inputs beside
  // it; returning it while ALSO removing the client derivation satisfies that
  // intent better than omitting it did, because there is no longer a second
  // implementation left to disagree.
  availability: PracticeAvailabilityDto;
}

// A null field means "this lesson has no such stage" — not "not started".
// Whether a stage exists at all is decided by content the client already
// holds: Lesson.videoUrl, Lesson.notes and Lesson.publishedTaskTypes.
export interface LessonProgressDto {
  steps: LessonStepsDto;
  quiz: LessonQuizProgressDto | null;
  trapHunter: LessonTrapProgressDto | null;
  practice: LessonPracticeProgressDto | null;
}

// --- Sprint 08 — GET /progress/courses --------------------------------------
//
// The canonical COURSE-level progress payload, and the only one. Every course
// surface (catalog, detail, grammar roadmap, dashboard, Continue Learning)
// reads this, so a percentage cannot mean one thing on one page and something
// else on the next.
//
// It supersedes GET /courses/:id/stage-progress, which returns raw per-stage
// rows the client then had to roll up itself. That endpoint is deprecated, not
// deleted — one sprint of overlap so a client mid-deploy does not 404.

export interface CourseLessonStatusDto {
  lessonId: string;
  orderIndex: number;
  status: LessonStatus;
}

export interface CourseProgressSummaryDto {
  courseId: string;
  // Counts EXCLUDE lessons with no completable stage (status NO_CONTENT), so
  // 100% stays reachable on a course that contains one. See lesson-status.ts.
  totalLessons: number;
  completedLessons: number;
  inProgressLessons: number;
  notStartedLessons: number;
  progressPercent: number;
  status: CourseStatus;
  // An ID, never a path. The client composes the route — see the note on
  // resolveContinueLesson in lesson-status.ts.
  continueLessonId: string | null;
  // Present only when the caller asks for `include=lessons`. The course detail
  // page needs a status per row; the catalog and the dashboard render summaries
  // and would otherwise be shipped every lesson status of every course listed.
  lessons: CourseLessonStatusDto[] | null;
}
