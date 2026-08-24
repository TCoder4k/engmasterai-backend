import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { QuizRateLimitGuard } from '../lesson/quiz/rate-limit/quiz-rate-limit.guard';
import { StreakModule } from '../streak/streak.module';
import { GamificationController } from './gamification.controller';
import { GamificationService } from './gamification.service';

// Sprint 10 — Gamification.
//
// WHY A TOP-LEVEL MODULE. The rule lesson.module.ts states is that a feature
// lives where the collectors it COMPOSES already live. This composes none of
// them — it is CALLED BY the lesson engine and the learning engine rather than
// reading their internals. Putting it inside LessonModule would make the
// lesson engine own the XP awarded for vocabulary reviews.
//
// THE DEPENDENCY DIRECTION IS LOAD-BEARING:
//
//     LessonModule  ─┐
//     LearningModule ┼──>  GamificationModule  ──>  PrismaModule
//                                              └──>  StreakModule
//
// StreakModule was added for Streak Together: recordProgress() calls
// StreakService.onUserActivityDay() as its one additive step whenever a new
// activity day just opened (see GamificationService's own header). This is
// safe in this direction only because StreakModule imports nothing from
// GamificationModule — a one-way edge, not a cycle. This module must still
// never import LessonModule, because LessonModule imports it.
//
// QuizRateLimitGuard is therefore declared as a PROVIDER here rather than
// obtained by importing LessonModule. That works because the guard needs only
// Reflector and RateLimiterService, and AuthModule is @Global() and exports the
// latter (auth.module.ts). It is the same pattern LearningModule already uses
// for LearningRateLimitGuard. (AnalyticsModule does import LessonModule for
// this guard; harmless there, but it would create the cycle here.)
//
// Exported so the two engines can inject GamificationService.
@Module({
  imports: [PrismaModule, StreakModule],
  controllers: [GamificationController],
  providers: [GamificationService, QuizRateLimitGuard],
  exports: [GamificationService],
})
export class GamificationModule {}
