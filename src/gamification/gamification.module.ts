import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { QuizRateLimitGuard } from '../lesson/quiz/rate-limit/quiz-rate-limit.guard';
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
//
// This module imports ONLY PrismaModule. It must never import LessonModule,
// because LessonModule imports it — that would be a genuine circular module
// dependency, not a stylistic concern.
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
  imports: [PrismaModule],
  controllers: [GamificationController],
  providers: [GamificationService, QuizRateLimitGuard],
  exports: [GamificationService],
})
export class GamificationModule {}
