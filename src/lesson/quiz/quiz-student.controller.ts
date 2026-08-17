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
import { QuizService } from './quiz.service';
import { SubmitQuizDto, AnswerQuestionDto } from './dto';
import { JwtAuthGuard } from '../../auth/guards';
import { QuizRateLimitGuard } from './rate-limit/quiz-rate-limit.guard';
import { QuizRateLimit } from './rate-limit/quiz-rate-limits.decorator';
import { toSubmitResponse } from './task-submit-response';
import type { AuthenticatedRequest } from '../../auth/types/authenticated-request.type';

// Sprint 06B — student-facing quiz endpoints. Every response here goes
// through GetQuizResponseDto (quiz.types.ts), which structurally has no
// correctAnswer/explanation field — see quiz.service.ts's STUDENT_QUESTION_SELECT.
@Controller('lessons/:lessonId/quiz')
export class QuizStudentController {
  constructor(private readonly quizService: QuizService) {}

  // READ-ONLY as of Sprint 07. It previously composed the read with the write
  // half (upsert progress, stamp attemptStartedAt, mint a shuffle seed), which
  // meant merely OPENING a finished quiz silently began a new attempt — the
  // student's stored summary was replaced by a blank question 1, and the clock
  // started on an attempt they never chose to take.
  //
  // Sprint 06D had already split readStudentTask from startStudentAttempt and
  // fixed exactly this for Advanced Practice; the quiz was left composed. This
  // is that same split applied here, not new engine code.
  //
  // Generous read-side bucket, matching Learning's queue endpoints — blunts
  // scraping without affecting normal navigation between questions.
  @UseGuards(JwtAuthGuard, QuizRateLimitGuard)
  @QuizRateLimit({ kind: 'read', max: 60, windowSeconds: 60 })
  @Get()
  async getQuiz(
    @Param('lessonId', ParseUUIDPipe) lessonId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.quizService.readStudentQuiz(lessonId, req.user.userId);
  }

  // Sprint 07 — the explicit start, mirroring POST /practice/start.
  //
  // Idempotent: an attempt already in flight is returned untouched, so a
  // double-click, a retried request or a mid-quiz refresh never restarts the
  // clock or reshuffles a question the student is already looking at.
  //
  // Shares the 'submit' bucket rather than 'read': this one writes, and a
  // student legitimately starts an attempt only a handful of times.
  @UseGuards(JwtAuthGuard, QuizRateLimitGuard)
  @QuizRateLimit({ kind: 'submit', max: 30, windowSeconds: 600 })
  @Post('start')
  async startQuiz(
    @Param('lessonId', ParseUUIDPipe) lessonId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.quizService.startQuizAttempt(lessonId, req.user.userId);
  }

  // Sprint 06B.5 — one request per question is ordinary traffic under
  // IMMEDIATE feedback, so this gets its own generous bucket rather than
  // sharing 'submit''s much tighter one (which would throttle a student
  // honestly working through a long quiz).
  @UseGuards(JwtAuthGuard, QuizRateLimitGuard)
  @QuizRateLimit({ kind: 'answer', max: 120, windowSeconds: 600 })
  @Post('answer')
  async answerQuestion(
    @Param('lessonId', ParseUUIDPipe) lessonId: string,
    @Body() dto: AnswerQuestionDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.quizService.answerQuestion(lessonId, req.user.userId, dto);
  }

  // Tighter bucket than reads — grading is real work and each submission
  // mutates progress state.
  @UseGuards(JwtAuthGuard, QuizRateLimitGuard)
  @QuizRateLimit({ kind: 'submit', max: 30, windowSeconds: 600 })
  @Post('submit')
  async submitQuiz(
    @Param('lessonId', ParseUUIDPipe) lessonId: string,
    @Body() dto: SubmitQuizDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return toSubmitResponse(
      await this.quizService.submitQuiz(lessonId, req.user.userId, dto),
    );
  }
}
