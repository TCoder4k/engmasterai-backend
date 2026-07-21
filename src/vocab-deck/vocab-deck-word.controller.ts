import {
  Body,
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
import { AttachVocabDeckWordsDto } from './dto';
import { JwtAuthGuard, RolesGuard } from '../auth/guards';
import { Roles } from '../auth/decorators';
import { UserRole } from '@prisma/client';

// Third controller in the vocab-deck module, extending the established
// two-controller split (VocabDeckLibraryController / VocabDeckController)
// with a third natural base: a deck's word membership.
@Controller('vocab/decks/:deckId/words')
export class VocabDeckWordController {
  constructor(private readonly vocabDeckService: VocabDeckService) {}

  // Any authenticated user — deck's words, behind the deck+library
  // published check.
  @UseGuards(JwtAuthGuard)
  @Get()
  async findWordsByDeck(
    @Param('deckId', ParseUUIDPipe) deckId: string,
    @Req() req,
  ) {
    return this.vocabDeckService.findWordsByDeck(deckId, req.user);
  }

  // Admin only — all attached words regardless of publish state.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get('manage')
  async findWordsByDeckManage(@Param('deckId', ParseUUIDPipe) deckId: string) {
    return this.vocabDeckService.findWordsByDeckManage(deckId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post()
  async attachWords(
    @Param('deckId', ParseUUIDPipe) deckId: string,
    @Body() dto: AttachVocabDeckWordsDto,
  ) {
    return this.vocabDeckService.attachWords(deckId, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Delete(':wordId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async detachWord(
    @Param('deckId', ParseUUIDPipe) deckId: string,
    @Param('wordId', ParseUUIDPipe) wordId: string,
  ) {
    return this.vocabDeckService.detachWord(deckId, wordId);
  }
}
