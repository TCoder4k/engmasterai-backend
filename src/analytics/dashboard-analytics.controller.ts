import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards';
import { QuizRateLimitGuard } from '../lesson/quiz/rate-limit/quiz-rate-limit.guard';
import { QuizRateLimit } from '../lesson/quiz/rate-limit/quiz-rate-limits.decorator';
import { DashboardAnalyticsService } from './dashboard-analytics.service';
import { DashboardAnalyticsQueryDto } from './dto/dashboard-analytics-query.dto';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request.type';

// Sprint 09 — GET /analytics/dashboard
//
// The dashboard's one analytics read. Deliberately NOT folded into
// GET /progress/courses: that endpoint is per-course progress, batched by
// courseIds and capped at twenty of them, while this has no course dimension
// at all. Sharing a route would have meant one of the two growing a parameter
// the other ignores.
//
// No query pipe is scoped here, unlike the course-progress controller: this DTO
// has no @Transform to run, only validation, which the app-wide ValidationPipe
// already performs. Adding a transform-enabled pipe for a single optional
// string would be cargo-culting the pattern rather than applying it.
@Controller('analytics')
export class DashboardAnalyticsController {
  constructor(private readonly analytics: DashboardAnalyticsService) {}

  // Read-only from the student's point of view — opening a dashboard must never
  // record that they studied anything. The one write behind this route is the
  // User.timezone bootstrap, which records a preference, not an activity.
  @UseGuards(JwtAuthGuard, QuizRateLimitGuard)
  @QuizRateLimit({ kind: 'stats', max: 30, windowSeconds: 60 })
  @Get('dashboard')
  async getDashboard(@Query() query: DashboardAnalyticsQueryDto, @Req() req: AuthenticatedRequest) {
    return this.analytics.getDashboardAnalytics(req.user.userId, query.tz);
  }
}
