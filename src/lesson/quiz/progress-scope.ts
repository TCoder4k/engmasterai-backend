import { Prisma } from '@prisma/client';

// Sprint 07 — the scope a batch progress collector runs over.
//
// The collectors (QuizService.collectCourseTaskProgress,
// TrapHunterService.collectCourseTrapProgress) were course-only until the
// lesson aggregate needed exactly the same roll-up for a single lesson.
// Parameterising the scope keeps ONE implementation of "read published tasks,
// join this user's progress, derive the stage view" — running the course
// version and filtering to one lesson would have read the whole course to
// answer a question about one lesson, and duplicating them would have created
// two definitions of stage progress that can drift.
//
// Visibility is deliberately NOT checked here. It stays the caller's job, so
// an aggregate can verify the lesson or course once and then roll up several
// stages without repeating the check per stage — the convention Sprint 06D
// established for the course aggregate.
export type ProgressScope =
  | { kind: 'course'; courseId: string }
  | { kind: 'lesson'; lessonId: string };

// Both branches keep `isPublished: true` on the lesson: draft content must
// never contribute to a student's progress calculation, at either scope.
export const scopeToTaskWhere = (
  scope: ProgressScope,
): Prisma.LessonTaskWhereInput => {
  if (scope.kind === 'course') {
    return { lesson: { courseId: scope.courseId, isPublished: true } };
  }
  return { lessonId: scope.lessonId, lesson: { isPublished: true } };
};
