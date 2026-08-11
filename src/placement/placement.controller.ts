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
  async setGoal(@Body() dto: SetPlacementGoalDto, @Req() req) {
    return this.placementService.setGoal(req.user.userId, dto.goal);
  }

  @UseGuards(JwtAuthGuard, QuizRateLimitGuard)
  @QuizRateLimit({ kind: 'placementSubmit', max: 30, windowSeconds: 600 })
  @Post('start-beginner')
  async startBeginner(@Req() req) {
    return this.placementService.startBeginner(req.user.userId);
  }

  @UseGuards(JwtAuthGuard, QuizRateLimitGuard)
  @QuizRateLimit({ kind: 'placementSubmit', max: 30, windowSeconds: 600 })
  @Post('start')
  async start(@Req() req) {
    return this.placementService.start(req.user.userId);
  }

  // Generous read-side bucket, matching every other GET in this codebase —
  // blunts scraping without affecting a student refreshing mid-test.
  @UseGuards(JwtAuthGuard, QuizRateLimitGuard)
  @QuizRateLimit({ kind: 'read', max: 60, windowSeconds: 60 })
  @Get('attempt')
  async getAttempt(@Req() req) {
    return this.placementService.getAttempt(req.user.userId);
  }

  @UseGuards(JwtAuthGuard, QuizRateLimitGuard)
  @QuizRateLimit({ kind: 'placementAnswer', max: 120, windowSeconds: 600 })
  @Post('attempt/:attemptId/answer')
  async answer(
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
    @Body() dto: AnswerPlacementQuestionDto,
    @Req() req,
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
    @Req() req,
  ) {
    return this.placementService.submit(req.user.userId, attemptId);
  }

  // Same generous read-side bucket as GET /placement/attempt.
  @UseGuards(JwtAuthGuard, QuizRateLimitGuard)
  @QuizRateLimit({ kind: 'read', max: 60, windowSeconds: 60 })
  @Get('roadmap')
  async getRoadmap(@Req() req) {
    return this.placementService.getRoadmap(req.user.userId);
  }
}
