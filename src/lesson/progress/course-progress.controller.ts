import {
  Controller,
  Get,
  Query,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards';
import { QuizRateLimitGuard } from '../quiz/rate-limit/quiz-rate-limit.guard';
import { QuizRateLimit } from '../quiz/rate-limit/quiz-rate-limits.decorator';
import { CourseProgressService } from './course-progress.service';
import { CourseProgressQueryDto } from './dto/course-progress-query.dto';
import type { AuthenticatedRequest } from '../../auth/types/authenticated-request.type';

// The app-wide ValidationPipe (main.ts) doesn't enable `transform`, so the
// DTO's @Transform would never run on a query string. Scoping a
// transform-enabled pipe to this one param keeps that local, exactly as
// CourseController does for its pagination query.
const queryPipe = new ValidationPipe({ transform: true });

// Sprint 08 — GET /progress/courses?courseIds=a,b,c
//
// The canonical course-progress read, and the only one. Batch by design: the
// catalog, the grammar roadmap and the dashboard each need progress for every
// course they list, and a per-course route would leave them looping — which is
// the client-side N+1 this sprint exists to remove.
//
// WHY A `progress` ROOT rather than `courses/:courseId/progress` or
// `courses/progress`:
//   - a `:courseId` path cannot express "these twelve courses" in one request;
//   - `courses/progress` would sit under CourseController's @Get(':id') and
//     depend on AppModule import order not to be swallowed by it — the same
//     collision course.controller.ts already documents WITHIN one controller,
//     except across modules, where it is decided by import order rather than
//     by declaration order and is therefore much easier to break by accident.
//
// This does invert the resource-scoped grammar of lessons/:id/progress, and
// that inconsistency is accepted knowingly rather than overlooked. The cleanup
// sprint may move the lesson aggregate to progress/lessons/:id for symmetry.
@Controller('progress')
export class CourseProgressController {
  constructor(private readonly courseProgress: CourseProgressService) {}

  // Read-only. Rendering a course card must never record that a student
  // started anything.
  @UseGuards(JwtAuthGuard, QuizRateLimitGuard)
  @QuizRateLimit({ kind: 'read', max: 60, windowSeconds: 60 })
  @Get('courses')
  async getCourseProgress(
    @Query(queryPipe) query: CourseProgressQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.courseProgress.getCourseProgress(
      query.courseIds,
      req.user.userId,
      { includeLessons: query.include === 'lessons' },
    );
  }
}
