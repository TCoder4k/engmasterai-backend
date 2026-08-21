import { Controller, Get, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard, RolesGuard } from '../auth/guards';
import { Roles } from '../auth/decorators';
import { QuizRateLimitGuard } from '../lesson/quiz/rate-limit/quiz-rate-limit.guard';
import { QuizRateLimit } from '../lesson/quiz/rate-limit/quiz-rate-limits.decorator';
import { AdminDashboardAnalyticsService } from './admin-dashboard-analytics.service';

// Admin-only sibling of GET /analytics/dashboard (per-user). Shares the
// 'stats' rate-limit kind with it — both are low-frequency dashboard-load
// reads, and this route is keyed by the admin's own userId so it cannot
// throttle any student's usage of the per-user route.
//
// Every number in the response is derived from rows the learning engines
// already write, same discipline as the per-user dashboard — see
// admin-dashboard-analytics.service.ts for exact definitions and null rules.
@Controller('analytics')
export class AdminDashboardAnalyticsController {
  constructor(private readonly adminAnalytics: AdminDashboardAnalyticsService) {}

  @UseGuards(JwtAuthGuard, RolesGuard, QuizRateLimitGuard)
  @Roles(UserRole.ADMIN)
  @QuizRateLimit({ kind: 'stats', max: 30, windowSeconds: 60 })
  @Get('admin-dashboard')
  async getAdminDashboard() {
    return this.adminAnalytics.getAdminDashboardAnalytics();
  }
}
