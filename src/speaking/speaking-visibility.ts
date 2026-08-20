import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// Speaking Partner — the ONE definition of "may this student see this
// exercise". Same two-level shape as listening-visibility.ts, kept as its
// own independent module rather than imported from Listening — every
// Gemini/content module in this codebase owns its own visibility predicate
// rather than reaching into another domain's, the same reasoning that keeps
// the Redis session/idempotency stores duplicated per module too.
//
// THE PREDICATE IS TWO LEVELS:
//
//     visible  <=>  exercise.isPublished  &&  exercise.scenario.isPublished
//
// The scenario half is what makes "unpublish a scenario" a real kill switch:
// an admin pulling a topic removes every exercise under it from the student
// surface at once, without touching each one.
//
// RE-CHECKED ON EVERY TURN, not just at attempt start — see
// SpeakingAttemptService.submitTurn(). If an admin unpublishes the exercise
// or its scenario mid-conversation, the very next turn must 404 instead of
// silently continuing to spend paid STT/AI calls against content that has
// been pulled — the same invariant Shadowing enforces on every attempt
// submission via visibleContentWhere.

export const visibleExerciseWhere = {
  isPublished: true,
  scenario: { isPublished: true },
} as const satisfies Prisma.SpeakingExerciseWhereInput;

/**
 * Throw unless `exerciseId` is student-visible.
 *
 * The 404 NEVER distinguishes "no such exercise" from "draft exercise" from
 * "exercise in a draft scenario", so an authenticated caller cannot use this
 * to enumerate unpublished ids. Same shape as assertContentVisible.
 */
export const assertExerciseVisible = async (
  prisma: PrismaService,
  exerciseId: string,
): Promise<void> => {
  const exercise = await prisma.speakingExercise.findFirst({
    where: { id: exerciseId, ...visibleExerciseWhere },
    select: { id: true },
  });

  if (!exercise) {
    throw new NotFoundException(`Speaking exercise with ID ${exerciseId} not found`);
  }
};
