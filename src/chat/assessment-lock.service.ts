import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AssessmentInProgressException } from './chat.exceptions';

/**
 * Backend-independent enforcement of "Engy is unavailable during the
 * Placement Test" — the ONE assessment-integrity check in Phase B (product
 * decision: Quiz/Trap Hunter/Advanced Practice stay fully available, no
 * lock added for them here or later without a separate decision).
 *
 * The frontend already excludes Engy from `/onboarding`/`/onboarding/retake`
 * by route structure (AssistantBoundary never wraps those routes) — this is
 * the server independently re-checking the same fact for
 * `POST /chat/messages` directly, so a client that calls the API without
 * going through the UI (or a stale tab) cannot bypass it. Never trusts
 * anything the client sends.
 */
@Injectable()
export class AssessmentLockService {
  constructor(private readonly prisma: PrismaService) {}

  /** Same query shape as PlacementService's own in-progress checks. */
  async assertNotInPlacementAttempt(userId: string): Promise<void> {
    const inProgress = await this.prisma.placementAttempt.findFirst({
      where: { userId, completedAt: null },
      select: { id: true },
    });
    if (inProgress) {
      throw new AssessmentInProgressException();
    }
  }
}
