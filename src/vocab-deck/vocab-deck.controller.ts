import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { VocabDeckService } from './vocab-deck.service';
import { UpdateVocabDeckDto } from './dto';
import { JwtAuthGuard, RolesGuard } from '../auth/guard';
import { Roles } from '../auth/decorator';
import { UserRole } from '@prisma/client';

@Controller('vocab/decks')
export class VocabDeckController {
  constructor(private readonly vocabDeckService: VocabDeckService) {}

  // Any authenticated user — the Phase-1 scope-cut endpoint, now with its
  // consumer (DeckDetailPage). Every other method below already looks the
  // deck up by id internally for its own guard checks.
  @UseGuards(JwtAuthGuard)
  @Get(':id')
  async findOnePublished(@Param('id', ParseUUIDPipe) id: string, @Req() req) {
    return this.vocabDeckService.findOnePublished(id, req.user);
  }

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
