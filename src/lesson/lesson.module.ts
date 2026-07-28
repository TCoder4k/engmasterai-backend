import { Module } from '@nestjs/common';
import { LessonController } from './lesson.controller';
import { LessonCourseController } from './lesson-course.controller';
import { LessonService } from './lesson.service';
import { PrismaModule } from '../prisma/prisma.module';
import { QuizStudentController } from './quiz/quiz-student.controller';
import { QuizAdminController } from './quiz/quiz-admin.controller';
import { QuizCourseController } from './quiz/quiz-course.controller';
import { QuizService } from './quiz/quiz.service';
import { QuizRateLimitGuard } from './quiz/rate-limit/quiz-rate-limit.guard';

// Sprint 06B — the Lesson Quiz Engine lives inside the existing Lesson
// module rather than a new top-level one (RateLimiterService/JwtAuthGuard
// need no import here either — AuthModule is @Global(), same as
// LearningModule's own comment on this).
@Module({
  imports: [PrismaModule],
  controllers: [
    LessonController,
    LessonCourseController,
    QuizStudentController,
    QuizAdminController,
    QuizCourseController,
  ],
  providers: [LessonService, QuizService, QuizRateLimitGuard],
  exports: [LessonService, QuizService],
})
export class LessonModule {}
