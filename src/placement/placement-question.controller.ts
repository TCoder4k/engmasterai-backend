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
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard, RolesGuard } from '../auth/guards';
import { Roles } from '../auth/decorators';
import { QuizRateLimitGuard } from '../lesson/quiz/rate-limit/quiz-rate-limit.guard';
import { QuizRateLimit } from '../lesson/quiz/rate-limit/quiz-rate-limits.decorator';
import { PlacementQuestionService } from './placement-question.service';
import {
  CreatePlacementQuestionDto,
  QueryPlacementQuestionDto,
  UpdatePlacementQuestionDto,
} from './dto';

// Personalized Onboarding & Placement Test — question bank authoring,
// ADMIN only. Same guard/rate-limit shape as every other admin surface in
// the codebase (see listening-admin.controller.ts): JwtAuthGuard +
// RolesGuard + @Roles(ADMIN) + the shared `manage` rate-limit kind, applied
// per-controller so a route added later cannot inherit an absence.
//
// `coverage` is declared BEFORE `:id` would be — there is no GET :id route
// here (the admin list already returns the full MANAGE shape per row, so
// the edit form prefills from the already-loaded row, matching
// AdminCourses.tsx's own pattern), so there is no actual ambiguity today,
// but the ordering is kept deliberately in case a GET :id is added later.
@Controller('placement/questions/manage')
@UseGuards(JwtAuthGuard, RolesGuard, QuizRateLimitGuard)
@Roles(UserRole.ADMIN)
@QuizRateLimit({ kind: 'manage', max: 120, windowSeconds: 60 })
export class PlacementQuestionController {
  constructor(private readonly questionService: PlacementQuestionService) {}

  @Get('coverage')
  async coverage() {
    return this.questionService.getCoverage();
  }

  @Get()
  async findAll(@Query() query: QueryPlacementQuestionDto) {
    return this.questionService.findAllManage(query);
  }

  @Post()
  async create(@Body() dto: CreatePlacementQuestionDto) {
    return this.questionService.create(dto);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlacementQuestionDto,
  ) {
    return this.questionService.update(id, dto);
  }

  @Patch(':id/publish')
  async publish(@Param('id', ParseUUIDPipe) id: string) {
    return this.questionService.publish(id);
  }

  @Patch(':id/unpublish')
  async unpublish(@Param('id', ParseUUIDPipe) id: string) {
    return this.questionService.unpublish(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.questionService.remove(id);
  }
}
