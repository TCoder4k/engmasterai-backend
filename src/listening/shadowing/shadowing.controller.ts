import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../../auth/guards';
import { QuizRateLimitGuard } from '../../lesson/quiz/rate-limit/quiz-rate-limit.guard';
import { QuizRateLimit } from '../../lesson/quiz/rate-limit/quiz-rate-limits.decorator';
import { ShadowingService, MAX_AUDIO_BYTES } from './shadowing.service';
import {
  QueryListeningProgressDto,
  RequestShadowingFeedbackDto,
  SubmitShadowingAttemptDto,
} from '../dto';

// Sprint 11 Phase 4B — the Shadowing write path.
//
// >>> `memoryStorage()` IS EXPLICIT, AND IT IS THE PRIVACY CONTROL <<<
// It happens to be multer's default, which is exactly why it is written out
// here: a default can be changed by someone adding an unrelated upload option
// later, and the consequence would be a student's voice silently landing in a
// temp directory on the server. Written down, it is a decision with a reason
// attached rather than a behaviour nobody chose.
//
// `limits.fileSize` is the same bound the service re-checks. Duplicated on
// purpose: multer aborts the stream at the socket so a hostile upload is never
// buffered, and the service's copy keeps the rule true if this interceptor is
// ever reconfigured. Neither is decoration.
//
// THE BODY NEEDS ITS OWN TRANSFORM-ENABLED PIPE. `main.ts` does NOT enable
// `transform` globally, and multipart delivers every non-file field as a
// string — so `durationMs` arrives as `"4200"`, the DTO's `@Transform` never
// runs without this pipe, and the string reaches Prisma and throws a 500 on an
// otherwise valid request. Found by an e2e test, not by inspection. The same
// workaround already exists for query DTOs in `dictation.controller.ts`;
// enabling `transform` globally would touch every endpoint in the app and is
// cleanup-sprint work.
const bodyPipe = new ValidationPipe({ transform: true });

// Same local, transform-enabled pipe DictationController uses for its query
// DTO — `main.ts` does not enable `transform` globally, so `contentIds` would
// otherwise arrive as the raw querystring value instead of a parsed array.
const queryPipe = new ValidationPipe({ transform: true });

// RATE-LIMIT KIND `speech`, its own bucket. The kind IS the bucket, and this
// one has a property none of the others do: every request costs money at an
// external provider. It is tighter than `dictation` (60/600s) because a
// shadowing sitting is a handful of spoken attempts rather than dozens of
// typed ones, and because the failure mode of a loose bucket here is a bill
// rather than a slow page.

@Controller('listening')
export class ShadowingController {
  constructor(private readonly shadowingService: ShadowingService) {}

  /**
   * Submit one spoken attempt for one sentence.
   *
   * `multipart/form-data`: `audio` is the recording, `clientAttemptId` and the
   * optional `durationMs` are ordinary fields. The body carries no transcript
   * and no score, because the DTO has no field for either — a client cannot
   * claim to have said something it did not say.
   */
  @UseGuards(JwtAuthGuard, QuizRateLimitGuard)
  @QuizRateLimit({ kind: 'speech', max: 30, windowSeconds: 600 })
  @Post('segments/:segmentId/shadowing/attempts')
  @UseInterceptors(
    FileInterceptor('audio', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_AUDIO_BYTES, files: 1 },
    }),
  )
  async submitAttempt(
    @Req() req: { user: { userId: string } },
    @Param('segmentId', ParseUUIDPipe) segmentId: string,
    @Body(bodyPipe) dto: SubmitShadowingAttemptDto,
    @UploadedFile() audio?: Express.Multer.File,
  ) {
    return this.shadowingService.submitAttempt(
      req.user.userId,
      segmentId,
      dto,
      audio,
    );
  }

  /**
   * Sprint 11 Phase 4C — ask for AI coaching on an attempt already graded.
   *
   * A SEPARATE, EXPLICIT REQUEST, not a field on the submit response. Two
   * reasons, both concrete: it is a second paid call, and most students will
   * never want it — attaching it to every submission would bill every attempt
   * for prose nobody read. It also keeps the verdict fast.
   *
   * THE AUDIO IS SENT AGAIN, because nothing kept it. The recording was
   * discarded within the submit request by design, and re-uploading is the
   * honest cost of that decision; the alternative — a stored copy of the
   * student's voice waiting in case they press a button — is exactly what this
   * feature refused to build. The re-uploaded clip is likewise held in memory
   * for one request and never written anywhere.
   *
   * OWN RATE-LIMIT KIND `aiFeedback`, 10/600s. Deliberately not `speech`: the
   * kind IS the bucket, and letting optional coaching drain the budget that
   * guards attempt submission would break the feature to protect the extra.
   */
  @UseGuards(JwtAuthGuard, QuizRateLimitGuard)
  @QuizRateLimit({ kind: 'aiFeedback', max: 10, windowSeconds: 600 })
  @Post('segments/:segmentId/shadowing/feedback')
  @UseInterceptors(
    FileInterceptor('audio', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_AUDIO_BYTES, files: 1 },
    }),
  )
  async requestFeedback(
    @Req() req: { user: { userId: string } },
    @Param('segmentId', ParseUUIDPipe) segmentId: string,
    @Body(bodyPipe) dto: RequestShadowingFeedbackDto,
    @UploadedFile() audio?: Express.Multer.File,
  ) {
    return this.shadowingService.requestFeedback(
      req.user.userId,
      segmentId,
      dto.clientAttemptId,
      audio,
    );
  }

  /**
   * Batch progress for a catalog page, Shadowing's counterpart of
   * `GET /listening/progress`. A SEPARATE PATH rather than a shared one:
   * both controllers mount at `/listening`, and `/listening/progress` is
   * already DictationController's — registering the same path twice would
   * make one of the two routes unreachable rather than fail loudly.
   *
   * Read-only, rate-limited under `read` like every other catalog-page GET —
   * navigating a catalog is ordinary browsing traffic, not the paid `speech`
   * path.
   */
  @UseGuards(JwtAuthGuard, QuizRateLimitGuard)
  @QuizRateLimit({ kind: 'read', max: 60, windowSeconds: 60 })
  @Get('shadowing/progress')
  async findProgress(
    @Req() req: { user: { userId: string } },
    @Query(queryPipe) query: QueryListeningProgressDto,
  ) {
    return this.shadowingService.findProgressSummaries(
      req.user.userId,
      query.contentIds,
    );
  }
}
