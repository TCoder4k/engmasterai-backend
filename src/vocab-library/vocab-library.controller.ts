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
  Post,
  Query,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { VocabLibraryService } from './vocab-library.service';
import { CreateVocabLibraryDto, UpdateVocabLibraryDto, QueryVocabLibraryDto } from './dto';
import { JwtAuthGuard, RolesGuard } from '../auth/guard';
import { Roles } from '../auth/decorator';
import { UserRole } from '@prisma/client';

// Same reasoning as CourseController: the app-wide ValidationPipe (main.ts)
// doesn't enable `transform`, so scope a transform-enabled pipe locally to
// these list endpoints instead of changing global validation behavior.
const queryPipe = new ValidationPipe({ transform: true });

@Controller('vocab/libraries')
export class VocabLibraryController {
  constructor(private readonly vocabLibraryService: VocabLibraryService) {}

  // Public — lists published libraries only (the anonymous-browsable shelf).
  @Get()
  async findPublished(@Query(queryPipe) query: QueryVocabLibraryDto) {
    return this.vocabLibraryService.findPublished(query.page, query.limit);
  }

  // Admin only — lists all libraries including drafts.
  // Declared before ':id' so it isn't swallowed by the dynamic route.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get('manage')
  async findAllManage(@Query(queryPipe) query: QueryVocabLibraryDto) {
    return this.vocabLibraryService.findAllManage(query.page, query.limit);
  }

  // Public — single published library.
  @Get(':id')
  async findOnePublished(@Param('id', ParseUUIDPipe) id: string) {
    return this.vocabLibraryService.findOnePublished(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post()
  async create(@Body() dto: CreateVocabLibraryDto) {
    return this.vocabLibraryService.create(dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVocabLibraryDto,
  ) {
    return this.vocabLibraryService.update(id, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Patch(':id/publish')
  async publish(@Param('id', ParseUUIDPipe) id: string) {
    return this.vocabLibraryService.publish(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Patch(':id/unpublish')
  async unpublish(@Param('id', ParseUUIDPipe) id: string) {
    return this.vocabLibraryService.unpublish(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.vocabLibraryService.remove(id);
  }
}
