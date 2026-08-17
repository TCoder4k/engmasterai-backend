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
import { LearningService } from './learning.service';
import { SubmitReviewDto } from './dto/submit-review.dto';
import { QueryDueReviewsDto } from './dto/query-due-reviews.dto';
import { LibrariesProgressQueryDto } from './dto/libraries-progress-query.dto';
import { JwtAuthGuard } from '../auth/guards';
import { LearningRateLimitGuard } from './rate-limit/learning-rate-limit.guard';
import { LearningRateLimit } from './rate-limit/learning-rate-limits.decorator';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request.type';

// Same reasoning as every other list/query DTO in this codebase: the
// app-wide ValidationPipe (main.ts) has no `transform`, so scope one
// locally to the query (see vocab-word.controller.ts's identical pattern).
const queryPipe = new ValidationPipe({ transform: true });

@Controller('learning')
export class LearningController {
  constructor(private readonly learningService: LearningService) {}

  // Generous read-side bucket — blunts queue-scraping without affecting
  // normal navigation (sprint plan §19).
  @UseGuards(JwtAuthGuard, LearningRateLimitGuard)
  @LearningRateLimit({ kind: 'queue', max: 60, windowSeconds: 60 })
  @Get('reviews/due')
  async getDueReviews(@Query(queryPipe) query: QueryDueReviewsDto, @Req() req: AuthenticatedRequest) {
    return this.learningService.getDueReviews(req.user.userId, query);
  }

  // Sprint 04C addition — see LearningService.getWordProgress's own
  // comment for why this exists alongside the due queue. Same read-side
  // bucket as the queue endpoint.
  @UseGuards(JwtAuthGuard, LearningRateLimitGuard)
  @LearningRateLimit({ kind: 'queue', max: 60, windowSeconds: 60 })
  @Get('words/:wordId/progress')
  async getWordProgress(
    @Param('wordId', ParseUUIDPipe) wordId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.learningService.getWordProgress(req.user.userId, wordId);
  }

  // Generous rating-side bucket — an abuse backstop, not a real-world
  // throttle on genuine rapid study (sprint plan §19).
  @UseGuards(JwtAuthGuard, LearningRateLimitGuard)
  @LearningRateLimit({ kind: 'review', max: 300, windowSeconds: 600 })
  @Post('words/:wordId/review')
  async submitReview(
    @Param('wordId', ParseUUIDPipe) wordId: string,
    @Body() dto: SubmitReviewDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.learningService.submitReview(req.user.userId, wordId, dto);
  }

  // Sprint 04D — real deck/library progress (§13). Same read-side bucket
  // as the queue/word-progress endpoints.
  @UseGuards(JwtAuthGuard, LearningRateLimitGuard)
  @LearningRateLimit({ kind: 'queue', max: 60, windowSeconds: 60 })
  @Get('decks/:deckId/progress')
  async getDeckProgress(
    @Param('deckId', ParseUUIDPipe) deckId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.learningService.getDeckProgress(req.user.userId, deckId);
  }

  // Sprint 04D UI-repair follow-up — one summary row per published library,
  // for the library grid (VocabLibraryPage). Registered before the
  // `:libraryId` route below for readability; the two paths don't actually
  // collide (this one has no `:libraryId` segment), but keeping the more
  // specific literal route first matches this codebase's existing
  // convention elsewhere (e.g. vocab-word.controller.ts's `manage` routes).
  // Sprint 09 follow-up — now also reports the daily NEW-word allowance, so the
  // dashboard's review card can say "23 to review + 15 new" instead of "23
  // waiting" and then opening a 38-card session. The service returns the whole
  // envelope; this no longer wraps it, because there are two top-level fields.
  //
  // `tz` is optional and READ-ONLY here: it buckets "today" for the quota count
  // but never writes User.timezone. Only getDueReviews bootstraps that column.
  @UseGuards(JwtAuthGuard, LearningRateLimitGuard)
  @LearningRateLimit({ kind: 'queue', max: 60, windowSeconds: 60 })
  @Get('libraries/progress')
  async getLibrariesProgress(
    @Query(queryPipe) query: LibrariesProgressQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.learningService.getLibrariesProgress(req.user.userId, query.tz);
  }

  @UseGuards(JwtAuthGuard, LearningRateLimitGuard)
  @LearningRateLimit({ kind: 'queue', max: 60, windowSeconds: 60 })
  @Get('libraries/:libraryId/progress')
  async getLibraryProgress(
    @Param('libraryId', ParseUUIDPipe) libraryId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.learningService.getLibraryProgress(req.user.userId, libraryId);
  }
}
