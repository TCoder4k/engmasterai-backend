import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards';
import { QuizRateLimitGuard } from '../../lesson/quiz/rate-limit/quiz-rate-limit.guard';
import { QuizRateLimit } from '../../lesson/quiz/rate-limit/quiz-rate-limits.decorator';
import { DictationService } from './dictation.service';
import { QueryListeningProgressDto, SubmitDictationAttemptDto } from '../dto';

// Sprint 11 Phase 4A — the Dictation write path and its batch read.
//
// ONE WRITE, ONE READ, AND THE READ WRITES NOTHING. Submitting an attempt is
// an explicit POST; there is no GET anywhere in this module that stamps a
// timestamp, opens a session or records an attempt. Sprint 07 had to fix a GET
// that started a quiz attempt, and the fix was to state this rather than leave
// it to be inferred.
//
// NO `POST .../start`. The Sprint 11 plan proposed one to create a
// content-level progress row; Phase 4A has no such row, because everything it
// would have carried is derived from the segment rows instead. A student is
// "started" when they have attempted a sentence, which is a fact about work
// done rather than about a button pressed.
//
// RATE-LIMIT KIND `dictation`, not `submit`. The kind IS the bucket: fifteen
// sentences at three tries each is 45 writes in one sitting, and `submit`
// (30/600s) would cut off exactly the student practising hardest. It is also
// deliberately not named `speech` — the Sprint 11 plan reserved that name for
// Shadowing, and there is no speech anywhere in this path.
const queryPipe = new ValidationPipe({ transform: true });

@Controller('listening')
export class DictationController {
  constructor(private readonly dictationService: DictationService) {}

  /**
   * Submit one dictation attempt for one sentence.
   *
   * The body carries what the student typed and how many words they revealed.
   * It carries no score, because the DTO has no field for one.
   */
  @UseGuards(JwtAuthGuard, QuizRateLimitGuard)
  @QuizRateLimit({ kind: 'dictation', max: 60, windowSeconds: 600 })
  @Post('segments/:segmentId/dictation/attempts')
  async submitAttempt(
    @Req() req: { user: { userId: string } },
    @Param('segmentId', ParseUUIDPipe) segmentId: string,
    @Body() dto: SubmitDictationAttemptDto,
  ) {
    return this.dictationService.submitAttempt(req.user.userId, segmentId, dto);
  }

  /**
   * Batch progress for a catalog page. Read-only.
   *
   * Ids the student cannot see are absent from the response rather than
   * raising — a single stale id must not fail the whole page, the same reason
   * `filterVisibleContentIds` filters where `assertContentVisible` throws.
   */
  @UseGuards(JwtAuthGuard, QuizRateLimitGuard)
  @QuizRateLimit({ kind: 'read', max: 60, windowSeconds: 60 })
  @Get('progress')
  async findProgress(
    @Req() req: { user: { userId: string } },
    @Query(queryPipe) query: QueryListeningProgressDto,
  ) {
    return this.dictationService.findProgressSummaries(
      req.user.userId,
      query.contentIds,
    );
  }
}
