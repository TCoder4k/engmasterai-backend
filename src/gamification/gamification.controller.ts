import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards';
import { QuizRateLimit } from '../lesson/quiz/rate-limit/quiz-rate-limits.decorator';
import { QuizRateLimitGuard } from '../lesson/quiz/rate-limit/quiz-rate-limit.guard';
import { GamificationService } from './gamification.service';
import { GamificationProfileDto } from './gamification.types';

// Sprint 10 — the one gamification read.
//
// THERE IS NO WRITE ENDPOINT, and there must never be one. XP is a consequence
// of learning actions the engines already record; an endpoint that accepted an
// award would be a client-authoritative score, which is the single rule this
// backend has never broken.
//
// The user id comes from the verified token only (req.user.userId) — no route
// or query parameter selects an account, so there is nothing to enumerate.
@Controller('gamification')
export class GamificationController {
  constructor(private readonly gamification: GamificationService) {}

  // A NEW rate-limit kind, deliberately not 'stats'.
  //
  // THE KIND IS THE BUCKET (`quiz:${kind}:${userId}`), so any two route groups
  // sharing a kind share one counter. Every student page mounts the level
  // widget, and /home also calls GET /analytics/dashboard, which is filed under
  // 'stats'. Sharing that bucket would drain it twice as fast on the busiest
  // navigation path in the app, and the symptom — "the dashboard sometimes
  // fails to load" — points nowhere near this endpoint. Sprint 07 ('step') and
  // Sprint 09 ('stats') both learned this the same way.
  //
  // 30/minute is generous for a page-level read that the client caches for the
  // whole session (GamificationProvider fetches once per login, not per page).
  @UseGuards(JwtAuthGuard, QuizRateLimitGuard)
  @QuizRateLimit({ kind: 'gamification', max: 30, windowSeconds: 60 })
  @Get('profile')
  async getProfile(@Req() req): Promise<GamificationProfileDto> {
    return this.gamification.buildProfile(req.user.userId);
  }
}
