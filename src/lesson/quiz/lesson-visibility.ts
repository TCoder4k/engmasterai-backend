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
