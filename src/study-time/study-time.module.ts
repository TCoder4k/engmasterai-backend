import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { QuizRateLimitGuard } from '../lesson/quiz/rate-limit/quiz-rate-limit.guard';
import { StudyTimeController } from './study-time.controller';
import { StudyTimeService } from './study-time.service';

// Sprint 10.5 — Study Time.
//
// WHY A TOP-LEVEL MODULE. The rule lesson.module.ts states is that a feature
// lives where the collectors it COMPOSES already live. This composes none of
// them: it writes one table of its own and reads nothing from the lesson or
// vocabulary engines. `activityType` names where the student was, but nothing
// here queries a lesson, a deck or a task.
//
// QuizRateLimitGuard is declared as a PROVIDER rather than obtained by
// importing LessonModule — the pattern gamification.module.ts set out, and for
// its stated reason: the guard needs only Reflector and RateLimiterService, and
// AuthModule is @Global() and exports the latter. AnalyticsModule does import
// LessonModule for this guard; that predates the cheaper option rather than
// endorsing it.
//
// NOTHING IS EXPORTED. The dashboard needs today's total, but it gets it from
// src/shared/study-time-window.ts — a pure helper with a structural client
// parameter — so AnalyticsModule never imports this module. Exporting the
// service would have coupled two modules so one could borrow a SUM.
@Module({
  imports: [PrismaModule],
  controllers: [StudyTimeController],
  providers: [StudyTimeService, QuizRateLimitGuard],
})
export class StudyTimeModule {}
