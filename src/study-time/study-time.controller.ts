import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards';
import { QuizRateLimit } from '../lesson/quiz/rate-limit/quiz-rate-limits.decorator';
import { QuizRateLimitGuard } from '../lesson/quiz/rate-limit/quiz-rate-limit.guard';
import { StudyHeartbeatDto } from './dto/study-heartbeat.dto';
import { StudyTimeService } from './study-time.service';
import { StudyHeartbeatResponseDto } from './study-time.types';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request.type';

// Sprint 10.5 — the one study-time write.
//
// There is no read endpoint here on purpose. Study minutes are displayed by
// GET /analytics/dashboard, which is already the dashboard's single
// time-window read and already resolves the effective timezone. A second
// endpoint returning the same number would be a second thing to keep in step.
//
// The user id comes from the verified token only — no route or query parameter
// selects an account, so there is nothing to enumerate and no cross-user write.
@Controller('study-time')
export class StudyTimeController {
  constructor(private readonly studyTime: StudyTimeService) {}

  // A NEW rate-limit kind, 'study'.
  //
  // THE KIND IS THE BUCKET (`quiz:${kind}:${userId}`), so any two route groups
  // sharing a kind share one counter. Filing heartbeats under 'step' would put
  // them in the same bucket as video progress — which already posts ~86 times
  // per ten-minute lesson — and the symptom would be "video progress stops
  // saving during long study sessions", pointing nowhere near this endpoint.
  // Sprints 07, 09 and 10 each learned this the same way.
  //
  // 20/minute against a client that flushes once a minute is ~20x headroom,
  // which covers retries and a brief backlog without leaving room for a script
  // to hammer the ledger. The convergence cap makes flooding pointless anyway;
  // this bounds the write cost of trying.
  @UseGuards(JwtAuthGuard, QuizRateLimitGuard)
  @QuizRateLimit({ kind: 'study', max: 20, windowSeconds: 60 })
  @Post('heartbeat')
  async heartbeat(
    @Req() req: AuthenticatedRequest,
    @Body() dto: StudyHeartbeatDto,
  ): Promise<StudyHeartbeatResponseDto> {
    return this.studyTime.recordHeartbeat(req.user.userId, dto);
  }
}
