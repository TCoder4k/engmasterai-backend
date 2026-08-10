import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { VocabDeckService } from './vocab-deck.service';
import { JwtAuthGuard } from '../auth/guards';
import { VocabDeckRateLimitGuard } from './rate-limit/vocab-deck-rate-limit.guard';
import { VocabDeckRateLimit } from './rate-limit/vocab-deck-rate-limits.decorator';

// Fourth controller in the vocab-deck module, extending the established
// three-controller split with a fourth natural base: a deck's persistent
// "Guess the Word" progress for the current user. Deliberately NOT part of
// LearningModule — this is not the SRS engine (see VocabGuessProgress in
// schema.prisma) — and deliberately not a new top-level module, since this
// controller's whole job is gated by the deck-access check
// VocabDeckWordController's own route already depends on.
@Controller('vocab/decks/:deckId/guess-progress')
export class VocabDeckGuessProgressController {
  constructor(private readonly vocabDeckService: VocabDeckService) {}

  // Read + mark-learned share the 'guessProgress' kind (and therefore MUST
  // share this exact policy — see the decorator's own comment): one read on
  // session load plus up to one write per correct word in a full deck pass.
  // 300/600s matches LearningController's own 'review' policy for the same
  // shape of traffic (frequent, per-word, session-scoped).
  @UseGuards(JwtAuthGuard, VocabDeckRateLimitGuard)
  @VocabDeckRateLimit({ kind: 'guessProgress', max: 300, windowSeconds: 600 })
  @Get()
  async getGuessProgress(
    @Param('deckId', ParseUUIDPipe) deckId: string,
    @Req() req,
  ) {
    return this.vocabDeckService.getGuessProgress(deckId, req.user);
  }

  @UseGuards(JwtAuthGuard, VocabDeckRateLimitGuard)
  @VocabDeckRateLimit({ kind: 'guessProgress', max: 300, windowSeconds: 600 })
  @Post('words/:wordId')
  async markWordLearned(
    @Param('deckId', ParseUUIDPipe) deckId: string,
    @Param('wordId', ParseUUIDPipe) wordId: string,
    @Req() req,
  ) {
    return this.vocabDeckService.markWordLearned(deckId, wordId, req.user);
  }

  // Powers "Học lại toàn bộ" — destructive, so the frontend gates this
  // behind an explicit confirmation before ever calling it. Its own kind,
  // kept deliberately tight (a student has no legitimate reason to reset
  // the same deck more than a handful of times in ten minutes).
  @UseGuards(JwtAuthGuard, VocabDeckRateLimitGuard)
  @VocabDeckRateLimit({ kind: 'guessProgressReset', max: 10, windowSeconds: 600 })
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetGuessProgress(
    @Param('deckId', ParseUUIDPipe) deckId: string,
    @Req() req,
  ) {
    return this.vocabDeckService.resetGuessProgress(deckId, req.user);
  }
}
