import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CourseProgressService } from '../lesson/progress/course-progress.service';
import { DashboardAnalyticsService } from '../analytics/dashboard-analytics.service';
import { RefreshTokenService } from '../auth/refresh-token.service';
import { SubscriptionGrantService } from '../payment/subscription-grant.service';
import { publishedTask } from '../shared/published-scope';
import { normalizeRoadmapItem } from '../placement/roadmap-item-compat';
import {
  AdminStudentDetail,
  AdminStudentListResult,
  AverageTestScore,
  RoadmapProgress,
} from './admin-student-overview.types';

// The generic GET /users list caps at 100 (UserService.MAX_LIMIT). This
// endpoint caps far lower on purpose: progressPercent (see
// admin-student-overview.types.ts) is a per-student roadmap computation that
// cannot be batched across users the way averageTestScore can (each
// student's roadmap names a different, arbitrary set of course ids), so one
// page of this list issues one CourseProgressService call per row, run in
// parallel. 20 rows x CourseProgressService's own constant ~10-query cost is
// a bounded, admin-only, occasional-traffic cost; 100 would not be.
const LIST_MAX_LIMIT = 20;
const DEFAULT_LIST_LIMIT = 10;
const RECENT_TESTS_LIMIT = 10;
const RECENT_PAYMENTS_LIMIT = 20;

@Injectable()
export class AdminStudentOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly courseProgress: CourseProgressService,
    private readonly dashboardAnalytics: DashboardAnalyticsService,
    private readonly refreshTokenService: RefreshTokenService,
    private readonly subscriptionGrant: SubscriptionGrantService,
  ) {}

  async grantSubscription(
    userId: string,
    plan: 'PRO' | 'HOC_TAP',
    durationDays: number,
  ): Promise<{ userId: string; plan: string; durationDays: number }> {
    await this.assertUserExists(userId);
    await this.subscriptionGrant.grantSubscription(
      this.prisma,
      userId,
      plan,
      durationDays,
    );
    return { userId, plan, durationDays };
  }

  async renewSubscription(
    userId: string,
    plan: 'PRO' | 'HOC_TAP',
    durationDays: number,
  ): Promise<{ userId: string; plan: string; durationDays: number }> {
    return this.grantSubscription(userId, plan, durationDays);
  }

  async revokeSubscription(
    userId: string,
    plan: 'PRO' | 'HOC_TAP',
  ): Promise<{ userId: string; plan: string; revoked: boolean }> {
    await this.assertUserExists(userId);
    await this.subscriptionGrant.revokeSubscription(this.prisma, userId, plan);
    return { userId, plan, revoked: true };
  }

  private async assertUserExists(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('Student not found');
  }

  async listOverview(
    page?: number,
    limit?: number,
    search?: string,
    plan?: 'FREE' | 'PRO' | 'HOC_TAP',
    status?: 'ACTIVE' | 'BLOCKED',
  ): Promise<AdminStudentListResult> {
    const take = Math.min(limit || DEFAULT_LIST_LIMIT, LIST_MAX_LIMIT);
    const skip = page ? (page - 1) * take : 0;
    const now = new Date();

    const trimmed = search?.trim();
    // Same PRO/FREE/HOC_TAP derivation as the response's own fields
    // (Subscription.expiresAt vs now) — never a persisted status, so the
    // filter and the displayed badge can never disagree.
    const filters: Prisma.UserWhereInput[] = [];
    if (trimmed) {
      filters.push({
        OR: [
          { name: { contains: trimmed, mode: 'insensitive' as const } },
          { email: { contains: trimmed, mode: 'insensitive' as const } },
          { id: trimmed },
        ],
      });
    }
    if (plan === 'PRO') {
      filters.push({
        subscriptions: {
          some: { plan: 'PRO_MONTHLY', expiresAt: { gt: now } },
        },
      });
    } else if (plan === 'HOC_TAP') {
      filters.push({
        subscriptions: {
          some: { plan: 'PREMIUM_MONTHLY', expiresAt: { gt: now } },
        },
      });
    } else if (plan === 'FREE') {
      filters.push({
        NOT: {
          subscriptions: {
            some: { expiresAt: { gt: now } },
          },
        },
      });
    }
    if (status === 'ACTIVE') {
      filters.push({ isActive: true });
    } else if (status === 'BLOCKED') {
      filters.push({ isActive: false });
    }
    const where: Prisma.UserWhereInput | undefined = filters.length
      ? { AND: filters }
      : undefined;

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          email: true,
          avatarUrl: true,
          role: true,
          level: true,
          learningGoal: true,
          isActive: true,
          createdAt: true,
          subscriptions: { select: { plan: true, expiresAt: true } },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    const userIds = users.map((u) => u.id);
    const [progressByUser, scoresByUser] = await Promise.all([
      // Not batchable (see LIST_MAX_LIMIT's comment) — one call per row,
      // in parallel rather than sequential.
      Promise.all(userIds.map((id) => this.computeRoadmapProgress(id))),
      this.computeAverageTestScores(userIds),
    ]);
    const progressById = new Map(
      userIds.map((id, i) => [id, progressByUser[i]]),
    );

    const data = users.map((user) => {
      const progress = progressById.get(user.id)!;
      const scores = scoresByUser.get(user.id)!;
      const proSub = user.subscriptions?.find(
        (s) => s.plan === 'PRO_MONTHLY' && s.expiresAt > now,
      );
      const hocTapSub = user.subscriptions?.find(
        (s) => s.plan === 'PREMIUM_MONTHLY' && s.expiresAt > now,
      );
      return {
        id: user.id,
        name: user.name,
        email: user.email,
        avatarUrl: user.avatarUrl,
        role: user.role,
        level: user.level,
        learningGoal: user.learningGoal,
        progressPercent: progress.progressPercent,
        completedLessons: progress.completedLessons,
        totalLessons: progress.totalLessons,
        averageTestScore: scores.averageTestScore,
        completedTestCount: scores.completedTestCount,
        isPro: proSub !== undefined,
        proExpiresAt: proSub?.expiresAt ?? null,
        isHocTap: hocTapSub !== undefined,
        hocTapExpiresAt: hocTapSub?.expiresAt ?? null,
        isActive: user.isActive,
        createdAt: user.createdAt,
      };
    });

    return {
      data,
      meta: {
        total,
        page: page || 1,
        limit: take,
        totalPages: Math.ceil(total / take),
      },
    };
  }

  async getDetail(id: string): Promise<AdminStudentDetail> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        avatarUrl: true,
        level: true,
        learningGoal: true,
        createdAt: true,
        isActive: true,
        subscriptions: { select: { plan: true, expiresAt: true } },
      },
    });
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    const [
      progress,
      scores,
      recentTests,
      dashboard,
      totalStudySeconds,
      speakingSessionsTotal,
      speakingSessionsCompleted,
      payments,
      paymentsTotal,
    ] = await Promise.all([
      this.computeRoadmapProgress(id),
      this.computeAverageTestScores([id]).then((m) => m.get(id)!),
      this.prisma.lessonTaskAttempt.findMany({
        where: { userId: id, task: publishedTask },
        orderBy: { submittedAt: 'desc' },
        take: RECENT_TESTS_LIMIT,
        select: {
          accuracyPercent: true,
          correctCount: true,
          totalCount: true,
          passed: true,
          submittedAt: true,
          task: {
            select: { title: true, lesson: { select: { title: true } } },
          },
        },
      }),
      // Reuses the student's own dashboard streak computation as-is
      // (timezone-aware, already shared) rather than a second streak
      // implementation that could disagree with it.
      this.dashboardAnalytics.getDashboardAnalytics(id),
      this.prisma.studyTimeEvent.aggregate({
        where: { userId: id },
        _sum: { creditedSeconds: true },
      }),
      this.prisma.speakingAttempt.count({ where: { userId: id } }),
      this.prisma.speakingAttempt.count({
        where: { userId: id, completedAt: { not: null } },
      }),
      this.prisma.payment.findMany({
        where: { userId: id },
        orderBy: { createdAt: 'desc' },
        take: RECENT_PAYMENTS_LIMIT,
        select: {
          paymentCode: true,
          amount: true,
          currency: true,
          status: true,
          createdAt: true,
          paidAt: true,
        },
      }),
      this.prisma.payment.count({ where: { userId: id } }),
    ]);

    const now = new Date();
    const proSub = user.subscriptions?.find(
      (s) => s.plan === 'PRO_MONTHLY' && s.expiresAt > now,
    );
    const hocTapSub = user.subscriptions?.find(
      (s) => s.plan === 'PREMIUM_MONTHLY' && s.expiresAt > now,
    );
    const isPro = proSub !== undefined;
    const proExpiresAt = proSub?.expiresAt ?? null;
    const isHocTap = hocTapSub !== undefined;
    const hocTapExpiresAt = hocTapSub?.expiresAt ?? null;
    const activePlan = hocTapSub
      ? hocTapSub.plan
      : proSub
        ? proSub.plan
        : null;

    return {
      profile: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatarUrl: user.avatarUrl,
        level: user.level,
        learningGoal: user.learningGoal,
        createdAt: user.createdAt,
        isActive: user.isActive,
        isPro,
        proExpiresAt,
        isHocTap,
        hocTapExpiresAt,
      },
      progress: {
        ...progress,
        ...scores,
        recentTests: recentTests.map((attempt) => ({
          taskTitle: attempt.task.title,
          lessonTitle: attempt.task.lesson.title,
          accuracyPercent: attempt.accuracyPercent,
          correctCount: attempt.correctCount,
          totalCount: attempt.totalCount,
          passed: attempt.passed,
          submittedAt: attempt.submittedAt,
        })),
      },
      activity: {
        totalStudySeconds: totalStudySeconds._sum.creditedSeconds ?? 0,
        currentStreakDays: dashboard.activity.currentStreakDays,
        speakingSessionsTotal,
        speakingSessionsCompleted,
      },
      billing: {
        plan: activePlan,
        isPro,
        proExpiresAt,
        isHocTap,
        hocTapExpiresAt,
        payments,
        paymentsTotal,
      },
    };
  }

  async setActiveStatus(
    id: string,
    isActive: boolean,
  ): Promise<{ id: string; isActive: boolean }> {
    const existing = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: { isActive },
      select: { id: true, isActive: true },
    });

    if (!isActive) {
      // Tears down every outstanding refresh session immediately, so a
      // blocked user cannot mint a new access token. The already-issued
      // access token (if any) is not revoked — see docs/memory.md for the
      // accepted, documented gap.
      await this.refreshTokenService.revokeAllForUser(id);
    }

    return updated;
  }

  // Sum of totalLessons/completedLessons across the COURSE-type items in
  // this student's own roadmap — see admin-student-overview.types.ts for why
  // this definition, not a global or task-level one, was chosen.
  private async computeRoadmapProgress(
    userId: string,
  ): Promise<RoadmapProgress> {
    const roadmap = await this.prisma.roadmap.findUnique({
      where: { userId },
      select: { items: true },
    });
    if (!roadmap) {
      return {
        progressPercent: null,
        completedLessons: 0,
        totalLessons: 0,
        hasRoadmap: false,
      };
    }

    const items = (roadmap.items as unknown[]).map(normalizeRoadmapItem);
    const courseIds = [
      ...new Set(
        items
          .filter((item) => item.resourceType === 'COURSE')
          .map((item) => item.resourceId),
      ),
    ];
    if (courseIds.length === 0) {
      return {
        progressPercent: null,
        completedLessons: 0,
        totalLessons: 0,
        hasRoadmap: true,
      };
    }

    const summaries = await this.courseProgress.getCourseProgress(
      courseIds,
      userId,
      { includeLessons: false },
    );
    const totalLessons = summaries.reduce((sum, c) => sum + c.totalLessons, 0);
    const completedLessons = summaries.reduce(
      (sum, c) => sum + c.completedLessons,
      0,
    );
    return {
      progressPercent:
        totalLessons > 0
          ? Math.round((completedLessons / totalLessons) * 100)
          : null,
      completedLessons,
      totalLessons,
      hasRoadmap: true,
    };
  }

  // Batched by design — unlike roadmap progress, this CAN be computed for
  // every user on a list page with one query (no per-user course scope),
  // so both listOverview and getDetail call this same implementation with
  // either the page's user ids or a single-element array — one definition,
  // never two.
  private async computeAverageTestScores(
    userIds: string[],
  ): Promise<Map<string, AverageTestScore>> {
    const result = new Map<string, AverageTestScore>(
      userIds.map((id) => [
        id,
        { averageTestScore: null, completedTestCount: 0 },
      ]),
    );
    if (userIds.length === 0) return result;

    const rows = await this.prisma.lessonTaskAttempt.groupBy({
      by: ['userId'],
      where: { userId: { in: userIds }, task: publishedTask },
      _avg: { accuracyPercent: true },
      _count: true,
    });
    for (const row of rows) {
      result.set(row.userId, {
        averageTestScore:
          row._avg.accuracyPercent !== null
            ? Math.round(row._avg.accuracyPercent)
            : null,
        completedTestCount: row._count,
      });
    }
    return result;
  }
}
