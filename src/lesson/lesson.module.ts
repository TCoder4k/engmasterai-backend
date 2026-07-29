import { Module } from '@nestjs/common';
import { LessonController } from './lesson.controller';
import { LessonCourseController } from './lesson-course.controller';
import { LessonService } from './lesson.service';
import { PrismaModule } from '../prisma/prisma.module';
import { QuizStudentController } from './quiz/quiz-student.controller';
import { QuizAdminController } from './quiz/quiz-admin.controller';
import { QuizCourseController } from './quiz/quiz-course.controller';
import { QuizService } from './quiz/quiz.service';
import {
  TrapHunterCourseController,
  TrapHunterStudentController,
} from './quiz/trap-hunter.controller';
import { TrapHunterService } from './quiz/trap-hunter.service';
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
    // Sprint 06C — Trap Hunter reuses the quiz engine's grader, progress row
    // and rate-limit guard, so it wires in here rather than as its own
    // module. It has no models, tables or scoring of its own.
    TrapHunterStudentController,
    TrapHunterCourseController,
  ],
  providers: [
    LessonService,
    QuizService,
    TrapHunterService,
    QuizRateLimitGuard,
  ],
  exports: [LessonService, QuizService, TrapHunterService],
})
export class LessonModule {}
