import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { PracticeService } from './practice.service';
import { SubmitQuizDto, AnswerQuestionDto } from './dto';
import { JwtAuthGuard } from '../../auth/guards';
import { QuizRateLimitGuard } from './rate-limit/quiz-rate-limit.guard';
import { QuizRateLimit } from './rate-limit/quiz-rate-limits.decorator';

// Sprint 06D — student-facing Advanced Practice endpoints.
//
// Mirrors QuizStudentController's shape deliberately: same guards, same rate
// limit kinds, same ParseUUIDPipe, same `req.user.userId`. A student reading
// these two files side by side should see one convention, not two.
//
// THE ONE STRUCTURAL DIFFERENCE, and the reason it exists: the quiz's GET
// starts an attempt, and this one does not. Advanced Practice opens on an
// intro screen ("Questions: N, Passing score: X%") whose only action is Start
// Practice, so a GET that stamped an attempt clock would record time against
// an attempt the student never began and hand them a fabricated duration on
// the summary. Starting is therefore its own endpoint, and it is also where
// prerequisites are enforced — the GET reports them instead (see
// PracticeAvailabilityDto).
@Controller('lessons/:lessonId/practice')
export class PracticeStudentController {
  constructor(private readonly practiceService: PracticeService) {}

  // READ-ONLY. Succeeds even when the stage is blocked or absent, returning
  // `availability` so the client can say WHY — the convention Trap Hunter set
  // in Sprint 06C.
  @UseGuards(JwtAuthGuard, QuizRateLimitGuard)
  @QuizRateLimit({ kind: 'read', max: 60, windowSeconds: 60 })
  @Get()
  async getPractice(
    @Param('lessonId', ParseUUIDPipe) lessonId: string,
    @Req() req,
  ) {
    return this.practiceService.getPractice(lessonId, req.user.userId);
  }

  // Shares the 'submit' bucket rather than 'read': this one writes, and a
  // student legitimately starts an attempt only a handful of times.
  @UseGuards(JwtAuthGuard, QuizRateLimitGuard)
  @QuizRateLimit({ kind: 'submit', max: 30, windowSeconds: 600 })
  @Post('start')
  async startPractice(
    @Param('lessonId', ParseUUIDPipe) lessonId: string,
    @Req() req,
  ) {
    return this.practiceService.startPractice(lessonId, req.user.userId);
  }

  @UseGuards(JwtAuthGuard, QuizRateLimitGuard)
  @QuizRateLimit({ kind: 'answer', max: 120, windowSeconds: 600 })
  @Post('answer')
  async answerPractice(
    @Param('lessonId', ParseUUIDPipe) lessonId: string,
    @Body() dto: AnswerQuestionDto,
    @Req() req,
  ) {
    return this.practiceService.answerPractice(lessonId, req.user.userId, dto);
  }

  @UseGuards(JwtAuthGuard, QuizRateLimitGuard)
  @QuizRateLimit({ kind: 'submit', max: 30, windowSeconds: 600 })
  @Post('submit')
  async submitPractice(
    @Param('lessonId', ParseUUIDPipe) lessonId: string,
    @Body() dto: SubmitQuizDto,
    @Req() req,
  ) {
    return this.practiceService.submitPractice(lessonId, req.user.userId, dto);
  }
}

// Sprint 06D — one request per course for EVERY stage that has a backend.
//
// The three per-stage endpoints (quiz-progress, trap-hunter-progress) still
// exist and still work; this replaces the need to call them together. Adding a
// stage used to mean adding a round trip to every surface that shows a
// percentage, which by Sprint 06E would have been four.
@Controller('courses/:courseId/stage-progress')
export class PracticeCourseController {
  constructor(private readonly practiceService: PracticeService) {}

  @UseGuards(JwtAuthGuard, QuizRateLimitGuard)
  @QuizRateLimit({ kind: 'read', max: 60, windowSeconds: 60 })
  @Get()
  async getStageProgress(
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Req() req,
  ) {
    return this.practiceService.getCourseStageProgress(
      courseId,
      req.user.userId,
    );
  }
}
