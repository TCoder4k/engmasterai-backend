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
import { LessonTaskType, UserRole } from '@prisma/client';
import { QuizService } from './quiz.service';
import { UpsertQuizDto } from './dto';
import { JwtAuthGuard, RolesGuard } from '../../auth/guards';
import { Roles } from '../../auth/decorators';

// Sprint 06D — admin authoring for Advanced Practice.
//
// Deliberately a thin re-pointing of QuizAdminController at a different task
// type, not a second authoring implementation. The whole-document upsert, the
// per-question validation, the publish guard (400 on zero questions) and the
// delete guard (409 once real attempts exist) are all the engine's existing
// behaviour reached with LessonTaskType.PRACTICE — an author gets the same
// rules for both tasks because it is literally the same code path.
//
// What Advanced Practice authoring means, and what the editor should say:
//   Lesson Quiz       — checks understanding of the lesson.
//   Advanced Practice — harder, contextual questions that reinforce and
//                       extend it. Difficulty comes from what the author
//                       WRITES; nothing here classifies a question as
//                       advanced automatically, and nothing generates one.
@Controller('lessons/:lessonId/practice')
export class PracticeAdminController {
  constructor(private readonly quizService: QuizService) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get('manage')
  async getManagePractice(@Param('lessonId', ParseUUIDPipe) lessonId: string) {
    return this.quizService.getManageTask(lessonId, LessonTaskType.PRACTICE);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Put()
  async upsertPractice(
    @Param('lessonId', ParseUUIDPipe) lessonId: string,
    @Body() dto: UpsertQuizDto,
  ) {
    return this.quizService.upsertTask(lessonId, LessonTaskType.PRACTICE, dto);
  }

  // Rejects a publish with zero questions, exactly as the quiz does — an
  // empty published task would show a student a stage with nothing in it and
  // block their lesson from completing.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Patch('publish')
  async publishPractice(@Param('lessonId', ParseUUIDPipe) lessonId: string) {
    return this.quizService.publishTask(lessonId, LessonTaskType.PRACTICE);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Patch('unpublish')
  async unpublishPractice(@Param('lessonId', ParseUUIDPipe) lessonId: string) {
    return this.quizService.unpublishTask(lessonId, LessonTaskType.PRACTICE);
  }

  // Refused (409) once any student has a real attempt — their recorded work
  // is not an admin's to discard by editing content.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async deletePractice(@Param('lessonId', ParseUUIDPipe) lessonId: string) {
    return this.quizService.deleteTask(lessonId, LessonTaskType.PRACTICE);
  }
}
