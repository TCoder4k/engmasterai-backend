import { Controller, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards';
import { SpeakingRateLimitGuard } from './rate-limit/speaking-rate-limit.guard';
import { SpeakingRateLimit } from './rate-limit/speaking-rate-limits.decorator';
import { SpeakingAttemptService } from './speaking-attempt.service';

// Speaking Partner — attempt lifecycle only (start/complete). The
// conversation itself is Gemini Live, over the /speaking/live WebSocket
// (see src/speaking/live/) — there is no more POST-per-turn route here; a
// student's audio never becomes a multipart HTTP upload in this pipeline.

interface RequestWithUser {
  user: { userId: string };
}

@Controller('speaking')
export class SpeakingAttemptController {
  constructor(private readonly attemptService: SpeakingAttemptService) {}

  /**
   * Start a new attempt for an exercise. No Gemini call — the opening line
   * is authored content, read straight off the exercise row. The response
   * also carries the one-shot `liveTicket` the frontend uses to open the
   * Speaking Live WebSocket for this attempt.
   */
  @UseGuards(JwtAuthGuard, SpeakingRateLimitGuard)
  @SpeakingRateLimit({ kind: 'start', max: 30, windowSeconds: 600 })
  @Post('exercises/:exerciseId/attempts')
  async start(
    @Req() req: RequestWithUser,
    @Param('exerciseId', ParseUUIDPipe) exerciseId: string,
  ) {
    return this.attemptService.start(req.user.userId, exerciseId);
  }

  /**
   * Complete an attempt. No Gemini call — turnCount is derived from the
   * live Redis session, not from a client-supplied value (the DTO has no
   * body at all). Idempotent: a second call returns the same result.
   */
  @UseGuards(JwtAuthGuard, SpeakingRateLimitGuard)
  @SpeakingRateLimit({ kind: 'complete', max: 30, windowSeconds: 600 })
  @Post('attempts/:attemptId/complete')
  async complete(
    @Req() req: RequestWithUser,
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
  ) {
    return this.attemptService.complete(req.user.userId, attemptId);
  }
}
