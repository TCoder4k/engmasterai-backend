import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Req,
  UseGuards,
} from '@nestjs/common';
import { QuizService } from './quiz.service';
import { JwtAuthGuard } from '../../auth/guards';
import { QuizRateLimitGuard } from './rate-limit/quiz-rate-limit.guard';
import { QuizRateLimit } from './rate-limit/quiz-rate-limits.decorator';

// GET /courses/:courseId/quiz-progress — one row per quiz-bearing published
// lesson, so the roadmap/course page needs one request instead of N (the
// same shape LearningController.getLibrariesProgress already uses).
@Controller('courses/:courseId/quiz-progress')
export class QuizCourseController {
  constructor(private readonly quizService: QuizService) {}

  @UseGuards(JwtAuthGuard, QuizRateLimitGuard)
  @QuizRateLimit({ kind: 'read', max: 60, windowSeconds: 60 })
  @Get()
  async getCourseQuizProgress(
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Req() req,
  ) {
    return {
      data: await this.quizService.getCourseQuizProgress(
        courseId,
        req.user.userId,
      ),
    };
  }
}
