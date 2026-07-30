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
//
// @deprecated Sprint 07. Superseded by GET /courses/:courseId/stage-progress,
// which returns this data plus trap hunter, practice and — as of Sprint 07 —
// the video/theory steps, in one request.
//
// Every in-repo consumer (CourseDetailPage, GrammarRoadmapPage, UserHome) was
// migrated to stage-progress in Sprint 07. This route is kept for one sprint
// only, so a client mid-deploy does not 404, and is deleted in the cleanup
// sprint alongside /courses/:courseId/trap-hunter-progress and the dead
// LessonTaskProgress.status column. DO NOT wire anything new to it.
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
