import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards';
import { QuizRateLimitGuard } from '../lesson/quiz/rate-limit/quiz-rate-limit.guard';
import { QuizRateLimit } from '../lesson/quiz/rate-limit/quiz-rate-limits.decorator';
import { ListeningContentService } from './listening-content.service';
import { DictationService } from './dictation/dictation.service';
import { ShadowingService } from './shadowing/shadowing.service';
import { QueryListeningCatalogDto } from './dto';

// Sprint 11 — the student-facing Listening reads.
//
// BOTH ROUTES ARE READ-ONLY, and that is a rule rather than a coincidence.
// Sprint 07 had to fix a GET that started a quiz attempt as a side effect,
// which recorded attempts students never took; every read in this module is
// written so there is nothing to fix later. Nothing here writes a row, stamps
// a timestamp or mints a session.
//
// AUTHENTICATED, not public. `GET /courses` is public because a marketing page
// lists courses; the Listening catalog is reached only from inside the student
// app (ProtectedRoute), and the rate-limit guard keys on the verified user id,
// which an anonymous request does not have.
//
// RATE-LIMIT KIND `read`, shared with the quiz/practice reads. Navigating a
// catalog is ordinary browsing traffic of exactly the kind that bucket was
// sized for. The chatty write path that will need its own kind (`speech`)
// arrives with Phase 4A, not here — adding it now would be an unused entry in
// a union whose whole point is that the kind IS the bucket.
//
// The app-wide ValidationPipe does not enable `transform`, so this scopes its
// own transform-enabled pipe to the query DTO — the same local fix
// CourseController uses, rather than changing global validation behaviour.
const queryPipe = new ValidationPipe({ transform: true });

@Controller('listening')
export class ListeningCatalogController {
  constructor(
    private readonly contentService: ListeningContentService,
    private readonly dictationService: DictationService,
    private readonly shadowingService: ShadowingService,
  ) {}

  @UseGuards(JwtAuthGuard, QuizRateLimitGuard)
  @QuizRateLimit({ kind: 'read', max: 60, windowSeconds: 60 })
  @Get('catalog')
  async findCatalog(@Query(queryPipe) query: QueryListeningCatalogDto) {
    return this.contentService.findCatalog(query);
  }

  // Anti-probing: a missing id, a draft recording and a recording in a draft
  // category all produce the SAME 404 (listening-visibility.ts). Do not add a
  // distinguishing message here.
  @UseGuards(JwtAuthGuard, QuizRateLimitGuard)
  @QuizRateLimit({ kind: 'read', max: 60, windowSeconds: 60 })
  @Get('contents/:contentId')
  async findOne(
    @Req() req: { user: { userId: string } },
    @Param('contentId', ParseUUIDPipe) contentId: string,
  ) {
    const content = await this.contentService.findOneVisible(contentId);

    // Sprint 11 Phase 4A. Composed HERE rather than inside
    // ListeningContentService, which is about content and has no business
    // knowing who is reading it. Progress is still absent for a recording
    // that does not enable DICTATION — null, not an empty summary, because
    // "this mode is off" and "you have done none of it" are different facts.
    // Both modes resolved together rather than in sequence: they are
    // independent reads and a student who has both enabled should not pay for
    // two round trips to see one page.
    const [dictationProgress, shadowingProgress] = await Promise.all([
      content.supportedModes.includes('DICTATION')
        ? this.dictationService.findContentProgress(req.user.userId, contentId)
        : Promise.resolve(null),
      content.supportedModes.includes('SHADOWING')
        ? this.shadowingService.findContentProgress(req.user.userId, contentId)
        : Promise.resolve(null),
    ]);

    return { ...content, dictationProgress, shadowingProgress };
  }
}
