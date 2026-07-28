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
  Put,
  UseGuards,
} from '@nestjs/common';
import { QuizService } from './quiz.service';
import { UpsertQuizDto } from './dto';
import { JwtAuthGuard, RolesGuard } from '../../auth/guards';
import { Roles } from '../../auth/decorators';
import { UserRole } from '@prisma/client';

// Sprint 06B — admin quiz authoring. Same base path as
// QuizStudentController (lessons/:lessonId/quiz) but every method here is
// ADMIN-only and none of them overlaps a student route+method combination.
@Controller('lessons/:lessonId/quiz')
export class QuizAdminController {
  constructor(private readonly quizService: QuizService) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get('manage')
  async getManageQuiz(@Param('lessonId', ParseUUIDPipe) lessonId: string) {
    return this.quizService.getManageQuiz(lessonId);
  }

  // Whole-document upsert — see QuizService.upsertQuiz and
  // UpsertQuizDto's own comment for why this replaces per-question CRUD.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Put()
  async upsertQuiz(
    @Param('lessonId', ParseUUIDPipe) lessonId: string,
    @Body() dto: UpsertQuizDto,
  ) {
    return this.quizService.upsertQuiz(lessonId, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Patch('publish')
  async publishQuiz(@Param('lessonId', ParseUUIDPipe) lessonId: string) {
    return this.quizService.publishQuiz(lessonId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Patch('unpublish')
  async unpublishQuiz(@Param('lessonId', ParseUUIDPipe) lessonId: string) {
    return this.quizService.unpublishQuiz(lessonId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteQuiz(@Param('lessonId', ParseUUIDPipe) lessonId: string) {
    return this.quizService.deleteQuiz(lessonId);
  }
}
