import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { QuizRateLimitGuard } from '../lesson/quiz/rate-limit/quiz-rate-limit.guard';
import { PlacementQuestionController } from './placement-question.controller';
import { PlacementQuestionService } from './placement-question.service';
import { PlacementController } from './placement.controller';
import { PlacementService } from './placement.service';
import { GeminiRoadmapAnalysisProvider } from './roadmap/gemini-roadmap-analysis.provider';
import { ROADMAP_ANALYSIS_PROVIDER } from './roadmap/roadmap-analysis.provider';
import { GeminiRoadmapPlannerProvider } from './roadmap/gemini-roadmap-planner.provider';
import { ROADMAP_PLANNER_PROVIDER } from './roadmap/roadmap-planner.provider';

// Personalized Onboarding & Placement Test.
//
// Phase 2 added the admin question bank (PlacementQuestionController/
// Service). Phase 3 adds the student-facing flow (goal, start-beginner,
// start/attempt/answer/submit, finalizeIfDue) via PlacementController/
// Service. Phase 6 adds the AI roadmap narration (POST
// /placement/roadmap/analysis, still on PlacementController — there is no
// separate controller for it, only a separate provider) behind its own
// DI token, the same reason ListeningModule binds Shadowing's two Gemini
// providers behind two tokens rather than one: it is what lets e2e and unit
// tests substitute a fake engine, without which the whole narration path
// would be untestable without a real, paid API call.
//
// QuizRateLimitGuard is declared as a local PROVIDER rather than obtained by
// importing LessonModule — the pattern study-time.module.ts and
// gamification.module.ts already establish: the guard needs only Reflector
// + RateLimiterService, and AuthModule is @Global() and exports the latter.
@Module({
  imports: [PrismaModule],
  controllers: [PlacementQuestionController, PlacementController],
  providers: [
    PlacementQuestionService,
    PlacementService,
    {
      provide: ROADMAP_ANALYSIS_PROVIDER,
      useClass: GeminiRoadmapAnalysisProvider,
    },
    {
      provide: ROADMAP_PLANNER_PROVIDER,
      useClass: GeminiRoadmapPlannerProvider,
    },
    QuizRateLimitGuard,
  ],
})
export class PlacementModule {}
