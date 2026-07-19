import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { VocabDeckService } from './vocab-deck.service';
import { UpdateVocabDeckDto } from './dto';
import { JwtAuthGuard, RolesGuard } from '../auth/guard';
import { Roles } from '../auth/decorator';
import { UserRole } from '@prisma/client';

// No GET :id in Phase 1 — a standalone single-deck read has no consumer yet
// (DeckDetailPage is deferred to Phase 2), so it isn't built ahead of a
// caller. Every method below already looks the deck up by id internally via
// the service's findOneOrThrow for its own guard checks.
@Controller('vocab/decks')
export class VocabDeckController {
  constructor(private readonly vocabDeckService: VocabDeckService) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVocabDeckDto,
  ) {
    return this.vocabDeckService.update(id, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Patch(':id/publish')
  async publish(@Param('id', ParseUUIDPipe) id: string) {
    return this.vocabDeckService.publish(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Patch(':id/unpublish')
  async unpublish(@Param('id', ParseUUIDPipe) id: string) {
    return this.vocabDeckService.unpublish(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.vocabDeckService.remove(id);
  }
}
