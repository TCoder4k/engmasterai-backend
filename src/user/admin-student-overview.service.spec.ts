/* eslint-disable @typescript-eslint/unbound-method -- jest.fn() mock references, not real unbound methods */
import { NotFoundException } from '@nestjs/common';
import { AdminStudentOverviewService } from './admin-student-overview.service';
import { PrismaService } from '../prisma/prisma.service';
import { CourseProgressService } from '../lesson/progress/course-progress.service';
import { DashboardAnalyticsService } from '../analytics/dashboard-analytics.service';
import { RefreshTokenService } from '../auth/refresh-token.service';

// Sprint 15 — unit coverage for the pieces test/admin-student-management.e2e-spec.ts
// cannot cheaply isolate: NotFoundException paths, and setActiveStatus only
// calling revokeAllForUser when actually blocking (never on unblock). The
// aggregation arithmetic itself (averageTestScore, roadmap progress) is
// verified against a real database in the e2e suite instead of re-mocked
// here — Prisma's groupBy/relation-filter behavior is exactly what would be
// faked away by mocking it.
describe('AdminStudentOverviewService', () => {
  let service: AdminStudentOverviewService;
  let prisma: {
    user: { findUnique: jest.Mock; update: jest.Mock };
    roadmap: { findUnique: jest.Mock };
  };
  let courseProgress: jest.Mocked<CourseProgressService>;
  let dashboardAnalytics: jest.Mocked<DashboardAnalyticsService>;
  let refreshTokenService: jest.Mocked<RefreshTokenService>;

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn(), update: jest.fn() },
      roadmap: { findUnique: jest.fn() },
    };
    courseProgress = {
      getCourseProgress: jest.fn(),
    } as unknown as jest.Mocked<CourseProgressService>;
    dashboardAnalytics = {
      getDashboardAnalytics: jest.fn(),
    } as unknown as jest.Mocked<DashboardAnalyticsService>;
    refreshTokenService = {
      revokeAllForUser: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<RefreshTokenService>;

    service = new AdminStudentOverviewService(
      prisma as unknown as PrismaService,
      courseProgress,
      dashboardAnalytics,
      refreshTokenService,
    );
  });

  describe('getDetail', () => {
    it('throws NotFoundException for a non-existent user id', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getDetail('missing-id')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('setActiveStatus', () => {
    it('throws NotFoundException for a non-existent user id', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.setActiveStatus('missing-id', false),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(refreshTokenService.revokeAllForUser).not.toHaveBeenCalled();
    });

    it('calls revokeAllForUser when blocking (isActive: false)', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
      prisma.user.update.mockResolvedValue({ id: 'u1', isActive: false });

      await service.setActiveStatus('u1', false);

      expect(refreshTokenService.revokeAllForUser).toHaveBeenCalledWith('u1');
    });

    it('does NOT call revokeAllForUser when unblocking (isActive: true)', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
      prisma.user.update.mockResolvedValue({ id: 'u1', isActive: true });

      await service.setActiveStatus('u1', true);

      expect(refreshTokenService.revokeAllForUser).not.toHaveBeenCalled();
    });
  });
});
