import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

// The anti-probing visibility check shared by QuizService and
// TrapHunterService.
//
// Sprint 06B wrote this as a private method on QuizService; Sprint 06C
// extracted it rather than letting a second service grow its own copy — two
// slightly-diverging 404 policies on the same lesson is exactly how an
// enumeration hole opens later.
//
// Same shape as LessonService.findOnePublished: the 404 never distinguishes
// "lesson doesn't exist" from "lesson or its course is a draft", so an
// authenticated caller cannot use these endpoints to enumerate unpublished
// content.
export const assertLessonVisible = async (
  prisma: PrismaService,
  lessonId: string,
): Promise<void> => {
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    select: { isPublished: true, course: { select: { isPublished: true } } },
  });
  if (!lesson || !lesson.isPublished || !lesson.course.isPublished) {
    throw new NotFoundException(`Quiz for lesson ${lessonId} not found`);
  }
};

// Course-level equivalent, shared for the same reason.
export const assertCourseAccessible = async (
  prisma: PrismaService,
  courseId: string,
): Promise<void> => {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { isPublished: true },
  });
  if (!course || !course.isPublished) {
    throw new NotFoundException(`Course with ID ${courseId} not found`);
  }
};

// Sprint 08 — the BATCH form, for the course-progress aggregate.
//
// It filters instead of throwing, and that difference is deliberate. The
// aggregate answers for a whole catalog page at once; one stale or unpublished
// id in that list must not fail the request for every other course on the
// page. Callers treat an absent courseId as "no progress available".
//
// This is NOT a weaker policy than assertCourseAccessible — it applies exactly
// the same predicate (`isPublished`), which is why it lives here rather than
// inline in the service. Sprint 06C extracted this file precisely so a second
// service could not grow its own slightly-different copy; a batch reader
// filtering on `isPublished: true` written somewhere else is how the two
// versions start to disagree.
//
// It leaks nothing: GET /courses is public and lists every published course,
// so which ids are published is already public information. The filter hides
// unpublished ids, which is the part that matters.
export const filterAccessibleCourses = async (
  prisma: PrismaService,
  courseIds: string[],
): Promise<string[]> => {
  if (courseIds.length === 0) return [];
  const courses = await prisma.course.findMany({
    where: { id: { in: courseIds }, isPublished: true },
    select: { id: true },
  });
  return courses.map((course) => course.id);
};
