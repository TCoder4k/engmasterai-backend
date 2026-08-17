import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards';
import { QuizRateLimitGuard } from '../quiz/rate-limit/quiz-rate-limit.guard';
import { QuizRateLimit } from '../quiz/rate-limit/quiz-rate-limits.decorator';
import { LessonProgressService } from './lesson-progress.service';
import type { AuthenticatedRequest } from '../../auth/types/authenticated-request.type';

// Sprint 07 — GET /lessons/:lessonId/progress.
//
// The lesson page's single progress request. It replaces three page-level
// calls (trap hunter, practice, and a quiz call that was never actually
// made) and adds the two stages that had no server representation at all
// before this sprint.
@Controller('lessons/:lessonId/progress')
export class LessonProgressController {
  constructor(private readonly progressService: LessonProgressService) {}

  // Read-only, and that is load-bearing rather than incidental: the lesson
  // page calls this on every visit, so any write here would record activity
  // for a student who merely looked at the page.
  @UseGuards(JwtAuthGuard, QuizRateLimitGuard)
  @QuizRateLimit({ kind: 'read', max: 60, windowSeconds: 60 })
  @Get()
  async getLessonProgress(
    @Param('lessonId', ParseUUIDPipe) lessonId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.progressService.getLessonProgress(lessonId, req.user.userId);
  }
}
