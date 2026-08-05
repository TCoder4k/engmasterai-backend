import { NotFoundException } from '@nestjs/common';
import { ListeningMode } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// Sprint 11 — the ONE definition of "may this student see this content".
//
// EXTRACTED ON DAY ONE, unlike its sibling. `lesson-visibility.ts` was written
// inline inside QuizService in Sprint 06B and only pulled out in 06C, once a
// second service needed it — and its header records why that was late: "two
// slightly-diverging 404 policies on the same lesson is exactly how an
// enumeration hole opens later." Listening has six student consumers planned
// (catalog, content detail, mode start, dictation submit, shadowing attempt,
// progress aggregate), so there was never a version of this module where one
// copy was enough.
//
// THE PREDICATE IS TWO LEVELS, exactly like lesson + course:
//
//     visible  <=>  content.isPublished  &&  content.category.isPublished
//
// The category half is what makes "unpublish a category" a real kill switch:
// an admin pulling a topic must remove every recording under it from the
// student surface at once, without touching each one.

/** The published-scope predicate, as a reusable Prisma `where` fragment. */
export const visibleContentWhere = {
  isPublished: true,
  category: { isPublished: true },
} as const;

/**
 * Throw unless `contentId` is student-visible.
 *
 * The 404 message NEVER distinguishes "no such content" from "draft content"
 * from "draft category", so an authenticated caller cannot use these endpoints
 * to enumerate unpublished ids. Same shape as `assertLessonVisible`.
 */
export const assertContentVisible = async (
  prisma: PrismaService,
  contentId: string,
): Promise<void> => {
  const content = await prisma.listeningContent.findFirst({
    where: { id: contentId, ...visibleContentWhere },
    select: { id: true },
  });

  if (!content) {
    throw new NotFoundException(
      `Listening content with ID ${contentId} not found`,
    );
  }
};

/**
 * Throw unless `contentId` is visible AND supports `mode`.
 *
 * An unsupported mode raises the SAME 404 as a missing content, on purpose:
 * "this recording exists but has no shadowing" is still information about a
 * recording, and the modes a draft enables are not the student's business.
 */
export const assertContentModeVisible = async (
  prisma: PrismaService,
  contentId: string,
  mode: ListeningMode,
): Promise<void> => {
  const content = await prisma.listeningContent.findFirst({
    where: {
      id: contentId,
      ...visibleContentWhere,
      supportedModes: { has: mode },
    },
    select: { id: true },
  });

  if (!content) {
    throw new NotFoundException(
      `Listening content with ID ${contentId} not found`,
    );
  }
};

/**
 * The BATCH form: filters instead of throwing.
 *
 * Deliberately different from `assertContentVisible`, for the reason
 * `filterAccessibleCourses` gives: a batch answers for a whole catalog page at
 * once, and one stale id in the caller's list must not fail the request for
 * every other item on the page. Callers treat an absent id as "not available".
 *
 * It applies EXACTLY the same predicate, which is why it lives here rather
 * than being written inline in a service — that is how the two copies would
 * start to disagree.
 */
export const filterVisibleContentIds = async (
  prisma: PrismaService,
  contentIds: string[],
): Promise<string[]> => {
  if (contentIds.length === 0) return [];

  const rows = await prisma.listeningContent.findMany({
    where: { id: { in: contentIds }, ...visibleContentWhere },
    select: { id: true },
  });

  return rows.map((row) => row.id);
};
