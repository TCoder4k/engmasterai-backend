import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards';
import { QuizRateLimitGuard } from '../quiz/rate-limit/quiz-rate-limit.guard';
import { QuizRateLimit } from '../quiz/rate-limit/quiz-rate-limits.decorator';
import { VideoProgressDto } from './dto/video-progress.dto';
import { LessonStepService } from './lesson-step.service';

// Sprint 07 — the write half for the VIDEO and THEORY steps.
//
// There is no GET here on purpose: reading step state belongs to the lesson
// aggregate (GET /lessons/:lessonId/progress), so the lesson page makes one
// request instead of one per stage. This controller only mutates.
//
// The guard is named QuizRateLimitGuard and these are not quiz routes. It is
// the generic userId-keyed limiter the whole lesson surface shares; renaming
// it would touch three controllers and two spec files for no behavioural
// change, and is recorded with the Sprint 07 cleanup instead.
@Controller('lessons/:lessonId/steps')
export class LessonStepController {
  constructor(private readonly stepService: LessonStepService) {}

  // 'step' is its OWN rate-limit bucket, not 'answer'. The guard keys on
  // `quiz:${kind}:${userId}`, so sharing a kind means sharing a counter — and
  // a playing video posts here roughly every 7 seconds. See the note on
  // QuizRateLimitKind.
  //
  // 150/600s covers ~86 posts from a 10-minute video plus pause, end and
  // unload flushes, with headroom. More than one 10-minute video cannot fit in
  // a 600-second window by definition.
  @UseGuards(JwtAuthGuard, QuizRateLimitGuard)
  @QuizRateLimit({ kind: 'step', max: 150, windowSeconds: 600 })
  @Post('video/progress')
  async recordVideoProgress(
    @Param('lessonId', ParseUUIDPipe) lessonId: string,
    @Body() dto: VideoProgressDto,
    @Req() req,
  ) {
    return this.stepService.recordVideoProgress(lessonId, req.user.userId, dto);
  }

  // Fires when the theory pane opens, so it runs on every visit to a lesson
  // the student has already read — idempotent by design, never restamping.
  @UseGuards(JwtAuthGuard, QuizRateLimitGuard)
  @QuizRateLimit({ kind: 'step', max: 150, windowSeconds: 600 })
  @Post('theory/start')
  async startTheory(
    @Param('lessonId', ParseUUIDPipe) lessonId: string,
    @Req() req,
  ) {
    return this.stepService.startTheory(lessonId, req.user.userId);
  }

  // The explicit "Tôi đã đọc xong" action. Scroll position does not complete
  // theory: an accidental scroll should never claim a student read something.
  @UseGuards(JwtAuthGuard, QuizRateLimitGuard)
  @QuizRateLimit({ kind: 'step', max: 150, windowSeconds: 600 })
  @Post('theory/complete')
  async completeTheory(
    @Param('lessonId', ParseUUIDPipe) lessonId: string,
    @Req() req,
  ) {
    return this.stepService.completeTheory(lessonId, req.user.userId);
  }
}
