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
import { TrapHunterService } from './trap-hunter.service';
import { AnswerTrapDto, RequestTrapHintDto } from './dto';
import { JwtAuthGuard } from '../../auth/guards';
import { QuizRateLimitGuard } from './rate-limit/quiz-rate-limit.guard';
import { QuizRateLimit } from './rate-limit/quiz-rate-limits.decorator';

// Sprint 06C — student-facing Trap Hunter endpoints.
//
// All three sit on the 'trap' rate-limit bucket rather than 'submit''s: a
// correction round is one request per trap plus one per hint unlocked, and
// a student working honestly through eight traps must not be throttled for
// it.
@Controller('lessons/:lessonId/trap-hunter')
export class TrapHunterStudentController {
  constructor(private readonly trapHunterService: TrapHunterService) {}

  @UseGuards(JwtAuthGuard, QuizRateLimitGuard)
  @QuizRateLimit({ kind: 'read', max: 60, windowSeconds: 60 })
  @Get()
  async getTrapHunter(
    @Param('lessonId', ParseUUIDPipe) lessonId: string,
    @Req() req,
  ) {
    return this.trapHunterService.getTrapHunter(lessonId, req.user.userId);
  }

  @UseGuards(JwtAuthGuard, QuizRateLimitGuard)
  @QuizRateLimit({ kind: 'trap', max: 120, windowSeconds: 600 })
  @Post('answer')
  async answerTrap(
    @Param('lessonId', ParseUUIDPipe) lessonId: string,
    @Body() dto: AnswerTrapDto,
    @Req() req,
  ) {
    return this.trapHunterService.answerTrap(lessonId, req.user.userId, dto);
  }

  @UseGuards(JwtAuthGuard, QuizRateLimitGuard)
  @QuizRateLimit({ kind: 'trap', max: 120, windowSeconds: 600 })
  @Post('hint')
  async requestHint(
    @Param('lessonId', ParseUUIDPipe) lessonId: string,
    @Body() dto: RequestTrapHintDto,
    @Req() req,
  ) {
    return this.trapHunterService.requestHint(lessonId, req.user.userId, dto);
  }
}

// GET /courses/:courseId/trap-hunter-progress — the batch companion, shaped
// exactly like QuizCourseController so the course page fetches both the same
// way.
@Controller('courses/:courseId/trap-hunter-progress')
export class TrapHunterCourseController {
  constructor(private readonly trapHunterService: TrapHunterService) {}

  @UseGuards(JwtAuthGuard, QuizRateLimitGuard)
  @QuizRateLimit({ kind: 'read', max: 60, windowSeconds: 60 })
  @Get()
  async getCourseTrapHunterProgress(
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Req() req,
  ) {
    return {
      data: await this.trapHunterService.getCourseTrapHunterProgress(
        courseId,
        req.user.userId,
      ),
    };
  }
}
