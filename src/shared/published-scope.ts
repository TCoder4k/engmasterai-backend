import { Prisma } from '@prisma/client';

// Sprint 10 — the account-wide "does this content count" predicate, extracted
// from DashboardAnalyticsService (Sprint 09) so the gamification aggregates
// share one definition with it rather than growing a second one.
//
// THERE ARE TWO PUBLICATION FILTERS IN THIS CODEBASE AND THEY ARE NOT THE
// SAME. Picking the wrong one is a silent counting bug, so the difference is
// written down here rather than left to be rediscovered:
//
//   src/lesson/quiz/progress-scope.ts   ->  lesson.isPublished ONLY
//       Used by the batch progress collectors, which are always called for an
//       explicit set of course ids that the caller has ALREADY filtered for
//       accessibility (filterAccessibleCourses). The course gate has been
//       applied one level up, so repeating it there would be redundant.
//
//   THIS FILE                           ->  lesson.isPublished AND course.isPublished
//       Used by reads with NO course scope at all — "everything this student
//       has ever finished". Nothing has filtered the courses beforehand, so
//       the course gate has to be here or a lesson inside an unpublished
//       course would be counted.
//
// Use this one for any account-wide count. Use progress-scope.ts when the
// caller already knows which courses it is asking about.
//
// Extracting these did not change any behaviour: they are byte-equivalent to
// the object literals DashboardAnalyticsService declared inline, and that
// service's spec — including its exact query-count assertion — passes
// unedited. If a change here ever requires editing that spec, the extraction
// has stopped being a move and become a rewrite.

/**
 * A lesson that a student can actually reach: published, in a published
 * course.
 */
export const publishedLesson: Prisma.LessonWhereInput = {
  isPublished: true,
  course: { isPublished: true },
};

/**
 * A quiz or practice task a student can actually reach. Published task,
 * published lesson, published course.
 */
export const publishedTask: Prisma.LessonTaskWhereInput = {
  isPublished: true,
  lesson: publishedLesson,
};
