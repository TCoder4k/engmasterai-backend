import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CourseProgressService } from './course-progress.service';
import { SubscriptionGrantService } from '../../payment/subscription-grant.service';
import { normalizeRoadmapItem } from '../../placement/roadmap-item-compat';

// 2026-09-16 pricing relaunch (Phase C) — "Hoàn thành 10 bài → tặng 7 ngày
// PRO". Reuses the exact same roadmap-based lesson-completion definition
// Sprint 15's admin overview already established (sum of completedLessons
// across the COURSE-type items in the student's own roadmap, via
// CourseProgressService.getCourseProgress) — NOT a second "lessons
// completed" metric that could disagree with the one already shown to
// admins and, indirectly, students (UserHome.tsx's own progress figure).
const MILESTONE_LESSONS = 10;
const REWARD_DAYS = 7;

@Injectable()
export class LessonMilestoneService {
  private readonly logger = new Logger(LessonMilestoneService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly courseProgress: CourseProgressService,
    private readonly subscriptionGrant: SubscriptionGrantService,
  ) {}

  /**
   * Lazy, read-time check (same self-healing pattern as StreakService's
   * BROKEN-pair auto-restart) — called from GET /analytics/dashboard, NOT
   * hooked into every individual lesson-completing write path (video step,
   * quiz submit, practice submit all call GamificationService.recordProgress
   * independently; threading a check into all of them would be far riskier
   * than one lazy read-time check the dashboard already pays for once per
   * visit). Best-effort: a failure here must never break the dashboard
   * response the caller is actually waiting on.
   */
  async checkAndGrant(userId: string): Promise<void> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { lessonMilestoneRewardedAt: true },
      });
      if (!user || user.lessonMilestoneRewardedAt) return;

      const completed = await this.countCompletedLessons(userId);
      if (completed < MILESTONE_LESSONS) return;

      // Idempotent claim — only the request that wins this conditional
      // update actually grants. A second concurrent dashboard load finds
      // lessonMilestoneRewardedAt already set and no-ops. Claim + grant run
      // in the SAME transaction so a crash between them can never leave the
      // flag set with no bonus actually applied.
      await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.user.updateMany({
          where: { id: userId, lessonMilestoneRewardedAt: null },
          data: { lessonMilestoneRewardedAt: new Date() },
        });
        if (claimed.count === 0) return;
        await this.subscriptionGrant.grantBonusDays(tx, userId, REWARD_DAYS);
      });
    } catch (error) {
      this.logger.warn(
        `Lesson-milestone check failed for user ${userId}, dashboard read proceeds unaffected: ${(error as Error).message}`,
      );
    }
  }

  private async countCompletedLessons(userId: string): Promise<number> {
    const roadmap = await this.prisma.roadmap.findUnique({
      where: { userId },
      select: { items: true },
    });
    if (!roadmap) return 0;

    const items = (roadmap.items as unknown[]).map(normalizeRoadmapItem);
    const courseIds = [
      ...new Set(
        items
          .filter((item) => item.resourceType === 'COURSE')
          .map((item) => item.resourceId),
      ),
    ];
    if (courseIds.length === 0) return 0;

    const summaries = await this.courseProgress.getCourseProgress(
      courseIds,
      userId,
      { includeLessons: false },
    );
    return summaries.reduce((sum, c) => sum + c.completedLessons, 0);
  }
}
