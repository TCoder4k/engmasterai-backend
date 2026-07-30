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
// Sprint 08 — 'courses' (plural) is the whole no-N+1 mechanism for the course
// aggregate. The catalog, the roadmap and the dashboard each need progress for
// EVERY course they list; without this member each of them would loop the
// 'course' scope and reissue the same collectors once per course, which is
// exactly the client-side N+1 that GrammarRoadmapPage shipped with. One member
// on this union turns N round trips into one, and no collector body changes.
export type ProgressScope =
  | { kind: 'course'; courseId: string }
  | { kind: 'courses'; courseIds: string[] }
  | { kind: 'lesson'; lessonId: string };

// Every branch keeps `isPublished: true` on the lesson: draft content must
// never contribute to a student's progress calculation, at any scope.
export const scopeToTaskWhere = (
  scope: ProgressScope,
): Prisma.LessonTaskWhereInput => {
  if (scope.kind === 'course') {
    return { lesson: { courseId: scope.courseId, isPublished: true } };
  }
  if (scope.kind === 'courses') {
    return { lesson: { courseId: { in: scope.courseIds }, isPublished: true } };
  }
  return { lessonId: scope.lessonId, lesson: { isPublished: true } };
};

// The same predicate expressed against Lesson rather than LessonTask, for the
// collectors that read lesson-scoped tables (LessonStepProgress) and for the
// aggregate's own lesson query. Kept beside scopeToTaskWhere so the two can
// never drift about what a scope MEANS — that drift would show up as a lesson
// counted by one collector and missed by another.
export const scopeToLessonWhere = (
  scope: ProgressScope,
): Prisma.LessonWhereInput => {
  if (scope.kind === 'course') {
    return { courseId: scope.courseId, isPublished: true };
  }
  if (scope.kind === 'courses') {
    return { courseId: { in: scope.courseIds }, isPublished: true };
  }
  return { id: scope.lessonId, isPublished: true };
};
