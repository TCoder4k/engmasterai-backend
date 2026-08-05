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
  Put,
  Query,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard, RolesGuard } from '../auth/guards';
import { Roles } from '../auth/decorators';
import { QuizRateLimitGuard } from '../lesson/quiz/rate-limit/quiz-rate-limit.guard';
import { QuizRateLimit } from '../lesson/quiz/rate-limit/quiz-rate-limits.decorator';
import { ListeningCategoryService } from './listening-category.service';
import { ListeningContentService } from './listening-content.service';
import {
  CreateListeningCategoryDto,
  CreateListeningContentDto,
  QueryListeningManageDto,
  UpdateListeningCategoryDto,
  UpdateListeningContentDto,
  UpsertListeningSegmentsDto,
} from './dto';

// Sprint 11 — Listening authoring, ADMIN only.
//
// Every route carries JwtAuthGuard + RolesGuard + @Roles(ADMIN). The frontend
// also gates /admin/* behind ProtectedRoute role="ADMIN", but that is a UX
// gate: this is the one that matters, and it is applied per route rather than
// per controller so that a route added later cannot inherit an absence.
//
// Kind `manage`, matching every other admin surface in the codebase.
const queryPipe = new ValidationPipe({ transform: true });

@Controller('listening/manage')
@UseGuards(JwtAuthGuard, RolesGuard, QuizRateLimitGuard)
@Roles(UserRole.ADMIN)
@QuizRateLimit({ kind: 'manage', max: 120, windowSeconds: 60 })
export class ListeningAdminController {
  constructor(
    private readonly categoryService: ListeningCategoryService,
    private readonly contentService: ListeningContentService,
  ) {}

  // --- categories -----------------------------------------------------------

  @Get('categories')
  async findCategories() {
    return this.categoryService.findAllManage();
  }

  @Post('categories')
  async createCategory(@Body() dto: CreateListeningCategoryDto) {
    return this.categoryService.create(dto);
  }

  @Patch('categories/:id')
  async updateCategory(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateListeningCategoryDto,
  ) {
    return this.categoryService.update(id, dto);
  }

  @Patch('categories/:id/publish')
  async publishCategory(@Param('id', ParseUUIDPipe) id: string) {
    return this.categoryService.publish(id);
  }

  // Takes every recording in this category off the student surface at once —
  // the contents keep their own isPublished, so re-publishing restores the
  // previous state rather than a flattened one.
  @Patch('categories/:id/unpublish')
  async unpublishCategory(@Param('id', ParseUUIDPipe) id: string) {
    return this.categoryService.unpublish(id);
  }

  @Delete('categories/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeCategory(@Param('id', ParseUUIDPipe) id: string) {
    return this.categoryService.remove(id);
  }

  // --- contents -------------------------------------------------------------

  @Get('contents')
  async findContents(@Query(queryPipe) query: QueryListeningManageDto) {
    return this.contentService.findAllManage(query);
  }

  @Get('contents/:id')
  async findContent(@Param('id', ParseUUIDPipe) id: string) {
    return this.contentService.findOneManage(id);
  }

  @Post('contents')
  async createContent(@Body() dto: CreateListeningContentDto) {
    return this.contentService.create(dto);
  }

  @Patch('contents/:id')
  async updateContent(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateListeningContentDto,
  ) {
    return this.contentService.update(id, dto);
  }

  /**
   * Whole-document segment upsert — surviving ids are updated IN PLACE.
   *
   * PUT rather than PATCH because the payload replaces the whole list, and the
   * array's own order becomes orderIndex. That is what makes a separate
   * reorder endpoint unnecessary, exactly as it does for
   * PUT /lessons/:lessonId/quiz.
   */
  @Put('contents/:id/segments')
  async upsertSegments(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertListeningSegmentsDto,
  ) {
    return this.contentService.upsertSegments(id, dto);
  }

  // 400 with the first real problem named — see validateContentForPublish.
  @Patch('contents/:id/publish')
  async publishContent(@Param('id', ParseUUIDPipe) id: string) {
    return this.contentService.publish(id);
  }

  @Patch('contents/:id/unpublish')
  async unpublishContent(@Param('id', ParseUUIDPipe) id: string) {
    return this.contentService.unpublish(id);
  }

  @Delete('contents/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeContent(@Param('id', ParseUUIDPipe) id: string) {
    return this.contentService.remove(id);
  }
}
