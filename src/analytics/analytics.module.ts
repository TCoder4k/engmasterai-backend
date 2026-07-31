import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { LessonModule } from '../lesson/lesson.module';
import { DashboardAnalyticsController } from './dashboard-analytics.controller';
import { DashboardAnalyticsService } from './dashboard-analytics.service';

// Sprint 09 — Dashboard Analytics.
//
// WHY A TOP-LEVEL MODULE, when Sprints 06B, 07 and 08 all chose to grow
// LessonModule instead. The rule those sprints followed is stated in
// lesson.module.ts: a feature lives where the collectors it COMPOSES already
// live. This one composes none of them.
//
// It reads five tables spanning two domains — LessonStepProgress,
// LessonTaskProgress and LessonTaskAttempt on the lesson side, WordReviewLog
// and UserWordProgress on the SRS side — with time-window counts that
// reimplement no rule from either. Putting it in LessonModule would make the
// lesson engine read the vocabulary tables; putting it in LearningModule would
// do the reverse. Neither owns "what happened this week".
//
// LessonModule is imported for QuizRateLimitGuard alone. JwtAuthGuard and
// RateLimiterService need no import — AuthModule is @Global() and exports both.
@Module({
  imports: [PrismaModule, LessonModule],
  controllers: [DashboardAnalyticsController],
  providers: [DashboardAnalyticsService],
})
export class AnalyticsModule {}
