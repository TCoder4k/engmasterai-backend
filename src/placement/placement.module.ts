import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { QuizRateLimitGuard } from '../lesson/quiz/rate-limit/quiz-rate-limit.guard';
import { PlacementQuestionController } from './placement-question.controller';
import { PlacementQuestionService } from './placement-question.service';
import { PlacementController } from './placement.controller';
import { PlacementService } from './placement.service';

// Personalized Onboarding & Placement Test.
//
// Phase 2 added the admin question bank (PlacementQuestionController/
// Service). Phase 3 adds the student-facing flow (goal, start-beginner,
// start/attempt/answer/submit, finalizeIfDue) via PlacementController/
// Service. The AI roadmap narration (RoadmapAnalysisProvider) and its own
// controller land in Phase 6 as this module keeps growing.
//
// QuizRateLimitGuard is declared as a local PROVIDER rather than obtained by
// importing LessonModule — the pattern study-time.module.ts and
// gamification.module.ts already establish: the guard needs only Reflector
// + RateLimiterService, and AuthModule is @Global() and exports the latter.
@Module({
  imports: [PrismaModule],
  controllers: [PlacementQuestionController, PlacementController],
  providers: [PlacementQuestionService, PlacementService, QuizRateLimitGuard],
})
export class PlacementModule {}
