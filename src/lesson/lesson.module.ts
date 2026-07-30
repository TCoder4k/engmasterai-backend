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
import {
  PracticeCourseController,
  PracticeStudentController,
} from './quiz/practice.controller';
import { PracticeAdminController } from './quiz/practice-admin.controller';
import { PracticeService } from './quiz/practice.service';
import { QuizRateLimitGuard } from './quiz/rate-limit/quiz-rate-limit.guard';
import { LessonStepController } from './steps/lesson-step.controller';
import { LessonStepService } from './steps/lesson-step.service';
import { LessonProgressController } from './progress/lesson-progress.controller';
import { LessonProgressService } from './progress/lesson-progress.service';

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
    // Sprint 06D — Advanced Practice is the SAME engine pointed at a
    // LessonTaskType.PRACTICE task, so it wires in here too. PracticeService
    // owns only availability and prerequisites; every graded operation is
    // delegated to QuizService. PracticeAdminController re-points the
    // existing authoring methods rather than duplicating them.
    PracticeStudentController,
    PracticeAdminController,
    PracticeCourseController,
    // Sprint 07 — the VIDEO and THEORY steps, and the lesson-level read that
    // ties every stage together. Both live in this module because they are
    // reads and writes over the same lesson content, and because the aggregate
    // composes the quiz/trap collectors that already live here.
    LessonStepController,
    LessonProgressController,
  ],
  providers: [
    LessonService,
    QuizService,
    TrapHunterService,
    PracticeService,
    LessonStepService,
    LessonProgressService,
    QuizRateLimitGuard,
  ],
  exports: [
    LessonService,
    QuizService,
    TrapHunterService,
    PracticeService,
    LessonStepService,
    LessonProgressService,
  ],
})
export class LessonModule {}
