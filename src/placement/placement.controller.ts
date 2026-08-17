import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards';
import { QuizRateLimitGuard } from '../lesson/quiz/rate-limit/quiz-rate-limit.guard';
import { QuizRateLimit } from '../lesson/quiz/rate-limit/quiz-rate-limits.decorator';
import { PlacementService } from './placement.service';
import { AnswerPlacementQuestionDto, SetPlacementGoalDto } from './dto';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request.type';

// Personalized Onboarding & Placement Test — student-facing flow (Phase 3).
// Same per-method @UseGuards repetition quiz-student.controller.ts uses
// rather than hoisting to the class, since the rate-limit KIND differs by
// route.
@Controller('placement')
export class PlacementController {
  constructor(private readonly placementService: PlacementService) {}

  // Shares 'placementSubmit' rather than getting its own kind — a goal pick
  // is a rare, low-frequency write, and the plan's three new kinds
  // (placementAnswer/placementSubmit/placementAnalysis) don't carve out a
  // fourth for this. The budget math in the decorator's own comment already
  // accounts for it comfortably.
  @UseGuards(JwtAuthGuard, QuizRateLimitGuard)
  @QuizRateLimit({ kind: 'placementSubmit', max: 30, windowSeconds: 600 })
  @Put('goal')
  async setGoal(@Body() dto: SetPlacementGoalDto, @Req() req: AuthenticatedRequest) {
    return this.placementService.setGoal(req.user.userId, dto.goal);
  }

  @UseGuards(JwtAuthGuard, QuizRateLimitGuard)
  @QuizRateLimit({ kind: 'placementSubmit', max: 30, windowSeconds: 600 })
  @Post('start-beginner')
  async startBeginner(@Req() req: AuthenticatedRequest) {
    return this.placementService.startBeginner(req.user.userId);
  }

  @UseGuards(JwtAuthGuard, QuizRateLimitGuard)
  @QuizRateLimit({ kind: 'placementSubmit', max: 30, windowSeconds: 600 })
  @Post('start')
  async start(@Req() req: AuthenticatedRequest) {
    return this.placementService.start(req.user.userId);
  }

  // Generous read-side bucket, matching every other GET in this codebase —
  // blunts scraping without affecting a student refreshing mid-test.
  @UseGuards(JwtAuthGuard, QuizRateLimitGuard)
  @QuizRateLimit({ kind: 'read', max: 60, windowSeconds: 60 })
  @Get('attempt')
  async getAttempt(@Req() req: AuthenticatedRequest) {
    return this.placementService.getAttempt(req.user.userId);
  }

  @UseGuards(JwtAuthGuard, QuizRateLimitGuard)
  @QuizRateLimit({ kind: 'placementAnswer', max: 120, windowSeconds: 600 })
  @Post('attempt/:attemptId/answer')
  async answer(
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
    @Body() dto: AnswerPlacementQuestionDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.placementService.answer(req.user.userId, attemptId, dto);
  }

  // No body — see placement.service.ts's submit() for why the graded answer
  // set is never taken from the request.
  @UseGuards(JwtAuthGuard, QuizRateLimitGuard)
  @QuizRateLimit({ kind: 'placementSubmit', max: 30, windowSeconds: 600 })
  @Post('attempt/:attemptId/submit')
  async submit(
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.placementService.submit(req.user.userId, attemptId);
  }

  // "Xem chi tiết bài làm" — same generous read-side bucket as the other
  // GETs here. Rejects (ConflictException) if the attempt isn't completed
  // yet; see PlacementService.getAttemptReview's own guard comment.
  @UseGuards(JwtAuthGuard, QuizRateLimitGuard)
  @QuizRateLimit({ kind: 'read', max: 60, windowSeconds: 60 })
  @Get('attempt/:attemptId/review')
  async getAttemptReview(
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.placementService.getAttemptReview(req.user.userId, attemptId);
  }

  // Same generous read-side bucket as GET /placement/attempt.
  @UseGuards(JwtAuthGuard, QuizRateLimitGuard)
  @QuizRateLimit({ kind: 'read', max: 60, windowSeconds: 60 })
  @Get('roadmap')
  async getRoadmap(@Req() req: AuthenticatedRequest) {
    return this.placementService.getRoadmap(req.user.userId);
  }

  // Phase 5 — wizard-internal resume authority. Called ONLY from inside
  // /onboarding, never from the app-wide gate (see PlacementStatusDto's
  // header note in placement.types.ts).
  @UseGuards(JwtAuthGuard, QuizRateLimitGuard)
  @QuizRateLimit({ kind: 'read', max: 60, windowSeconds: 60 })
  @Get('status')
  async getStatus(@Req() req: AuthenticatedRequest) {
    return this.placementService.getStatus(req.user.userId);
  }

  // Phase 6 — optional, cached AI narrative on top of the deterministic
  // roadmap. No body: everything it needs (goal, level, section scores, the
  // finished phase list) is read from the caller's own stored Roadmap/
  // PlacementAttempt rows, never from the request — the same reasoning
  // `submit` already applies (see placement.service.ts's header note there).
  //
  // OWN RATE-LIMIT KIND `placementAnalysis`, split from `placementSubmit` for
  // the same reason Shadowing's `aiFeedback` is split from `speech`: this is
  // a second, optional, PAID request, and letting it share the budget that
  // guards the actual test flow would break the feature to protect the extra.
  @UseGuards(JwtAuthGuard, QuizRateLimitGuard)
  @QuizRateLimit({ kind: 'placementAnalysis', max: 10, windowSeconds: 600 })
  @Post('roadmap/analysis')
  async requestRoadmapAnalysis(@Req() req: AuthenticatedRequest) {
    return this.placementService.requestRoadmapAnalysis(req.user.userId);
  }

  // Phase 4 (AI-assisted planning) — hybrid course SELECTION, not narration:
  // deterministic candidates -> AI planner -> strict validation -> persist,
  // falling back to the already-correct deterministic roadmap on any
  // failure (see PlacementService.requestRoadmapPlan). No body, same
  // reasoning as /analysis above.
  //
  // REUSES `placementAnalysis`'s rate-limit kind rather than a new one: both
  // are optional, low-frequency, paid AI calls, and the bucket-splitting
  // rule this file already follows (see /analysis's own comment) only
  // protects the CORE test flow from an optional AI call — it has never
  // been used to separate one optional AI call from another. A full
  // onboarding session is ~1 /plan call plus, later, ~1 /analysis call from
  // the dashboard — comfortably inside 10/600s even for a student who
  // retakes the test several times in one sitting.
  @UseGuards(JwtAuthGuard, QuizRateLimitGuard)
  @QuizRateLimit({ kind: 'placementAnalysis', max: 10, windowSeconds: 600 })
  @Post('roadmap/plan')
  async requestRoadmapPlan(@Req() req: AuthenticatedRequest) {
    return this.placementService.requestRoadmapPlan(req.user.userId);
  }
}
