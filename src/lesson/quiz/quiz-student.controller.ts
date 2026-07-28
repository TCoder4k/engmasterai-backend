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

// Sprint 06B — student-facing quiz endpoints. Every response here goes
// through GetQuizResponseDto (quiz.types.ts), which structurally has no
// correctAnswer/explanation field — see quiz.service.ts's STUDENT_QUESTION_SELECT.
@Controller('lessons/:lessonId/quiz')
export class QuizStudentController {
  constructor(private readonly quizService: QuizService) {}

  // Generous read-side bucket, matching Learning's queue endpoints — blunts
  // scraping without affecting normal navigation between questions.
  @UseGuards(JwtAuthGuard, QuizRateLimitGuard)
  @QuizRateLimit({ kind: 'read', max: 60, windowSeconds: 60 })
  @Get()
  async getQuiz(
    @Param('lessonId', ParseUUIDPipe) lessonId: string,
    @Req() req,
  ) {
    return this.quizService.getStudentQuiz(lessonId, req.user.userId);
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
    @Req() req,
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
    @Req() req,
  ) {
    return this.quizService.submitQuiz(lessonId, req.user.userId, dto);
  }
}
