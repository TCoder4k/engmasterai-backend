import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { VocabDeckService } from './vocab-deck.service';
import { CreateVocabDeckDto } from './dto';
import { JwtAuthGuard, RolesGuard } from '../auth/guard';
import { Roles } from '../auth/decorator';
import { UserRole } from '@prisma/client';

@Controller('vocab/libraries/:libraryId/decks')
export class VocabDeckLibraryController {
  constructor(private readonly vocabDeckService: VocabDeckService) {}

  // Any authenticated user — published decks of an accessible library.
  // Requires auth (unlike the public library catalog) because this is the
  // first step into the learning experience proper, and it's also the level
  // where per-user state (Phase 3+) will attach.
  @UseGuards(JwtAuthGuard)
  @Get()
  async findPublishedByLibrary(
    @Param('libraryId', ParseUUIDPipe) libraryId: string,
    @Req() req,
  ) {
    return this.vocabDeckService.findPublishedByLibrary(libraryId, req.user);
  }

  // Admin only — all decks for the library, including drafts.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get('manage')
  async findAllByLibraryManage(@Param('libraryId', ParseUUIDPipe) libraryId: string) {
    return this.vocabDeckService.findAllByLibraryManage(libraryId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post()
  async create(
    @Param('libraryId', ParseUUIDPipe) libraryId: string,
    @Body() dto: CreateVocabDeckDto,
  ) {
    return this.vocabDeckService.create(libraryId, dto);
  }
}
