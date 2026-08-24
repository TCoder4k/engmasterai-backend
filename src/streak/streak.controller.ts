import { Body, Controller, Get, Param, Post, Query, Req, UseGuards, ValidationPipe } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards';
import { RateLimiterService } from '../auth/rate-limit/rate-limiter.service';
import { RateLimitExceededException } from '../auth/exceptions/rate-limit-exceeded.exception';
import { StreakRateLimitGuard } from './rate-limit/streak-rate-limit.guard';
import { StreakRateLimit } from './rate-limit/streak-rate-limits.decorator';
import { StreakService } from './streak.service';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { QueryInvitationsDto } from './dto/query-invitations.dto';

interface RequestWithUser extends Request {
  user: { userId: string };
}

// main.ts does not enable `transform` globally — same local-pipe workaround
// every other controller in this codebase uses for its own body/query DTOs.
const bodyPipe = new ValidationPipe({ transform: true });
const queryPipe = new ValidationPipe({ transform: true });

@Controller('streaks')
export class StreakController {
  constructor(
    private readonly streakService: StreakService,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  // ---- invitations --------------------------------------------------------

  @UseGuards(JwtAuthGuard, StreakRateLimitGuard)
  @StreakRateLimit({ kind: 'invite', max: 10, windowSeconds: 3600 })
  @Post('invitations')
  async sendInvitation(@Req() req: RequestWithUser, @Body(bodyPipe) dto: CreateInvitationDto) {
    return this.streakService.sendInvitation(req.user.userId, dto.inviteeId);
  }

  @UseGuards(JwtAuthGuard, StreakRateLimitGuard)
  @StreakRateLimit({ kind: 'read', max: 60, windowSeconds: 60 })
  @Get('invitations')
  async listInvitations(@Req() req: RequestWithUser, @Query(queryPipe) query: QueryInvitationsDto) {
    return this.streakService.listInvitations(req.user.userId, query.direction, query.status);
  }

  @UseGuards(JwtAuthGuard, StreakRateLimitGuard)
  @StreakRateLimit({ kind: 'respond', max: 30, windowSeconds: 3600 })
  @Post('invitations/:id/accept')
  async acceptInvitation(@Req() req: RequestWithUser, @Param('id') id: string) {
    return this.streakService.acceptInvitation(req.user.userId, id);
  }

  @UseGuards(JwtAuthGuard, StreakRateLimitGuard)
  @StreakRateLimit({ kind: 'respond', max: 30, windowSeconds: 3600 })
  @Post('invitations/:id/decline')
  async declineInvitation(@Req() req: RequestWithUser, @Param('id') id: string) {
    await this.streakService.declineInvitation(req.user.userId, id);
    return { success: true };
  }

  @UseGuards(JwtAuthGuard, StreakRateLimitGuard)
  @StreakRateLimit({ kind: 'respond', max: 30, windowSeconds: 3600 })
  @Post('invitations/:id/cancel')
  async cancelInvitation(@Req() req: RequestWithUser, @Param('id') id: string) {
    await this.streakService.cancelInvitation(req.user.userId, id);
    return { success: true };
  }

  // ---- streaks --------------------------------------------------------------

  @UseGuards(JwtAuthGuard, StreakRateLimitGuard)
  @StreakRateLimit({ kind: 'read', max: 60, windowSeconds: 60 })
  @Get()
  async listMyStreaks(@Req() req: RequestWithUser) {
    return this.streakService.listMyStreaks(req.user.userId);
  }

  // Registered BEFORE ':id' below — 'leaderboard' as a literal path segment
  // must be matched first, or Nest would treat it as a pair id.
  @UseGuards(JwtAuthGuard, StreakRateLimitGuard)
  @StreakRateLimit({ kind: 'read', max: 60, windowSeconds: 60 })
  @Get('leaderboard')
  async getLeaderboard(@Req() req: RequestWithUser) {
    return this.streakService.getLeaderboard(req.user.userId);
  }

  /** "What's my relationship with this user?" — powers the Community Chat entry point. */
  @UseGuards(JwtAuthGuard, StreakRateLimitGuard)
  @StreakRateLimit({ kind: 'read', max: 60, windowSeconds: 60 })
  @Get('pair/:userId')
  async getPairStatus(@Req() req: RequestWithUser, @Param('userId') userId: string) {
    return this.streakService.getPairStatus(req.user.userId, userId);
  }

  /**
   * PUBLIC, unauthenticated — the first route in this backend outside
   * /auth/* with no JwtAuthGuard. Rate-limited by IP, since there is no
   * authenticated user to key on.
   */
  @Get('public/:shareId')
  async getPublicStreak(@Req() req: Request, @Param('shareId') shareId: string) {
    const result = await this.rateLimiter.checkAndIncrement(`streak:public-read:${req.ip}`, 30, 60);
    if (!result.allowed) throw new RateLimitExceededException();
    return this.streakService.getPublicStreak(shareId);
  }

  @UseGuards(JwtAuthGuard, StreakRateLimitGuard)
  @StreakRateLimit({ kind: 'read', max: 60, windowSeconds: 60 })
  @Get(':id')
  async getStreakDetail(@Req() req: RequestWithUser, @Param('id') id: string) {
    return this.streakService.getStreakDetail(req.user.userId, id);
  }

  @UseGuards(JwtAuthGuard, StreakRateLimitGuard)
  @StreakRateLimit({ kind: 'share', max: 10, windowSeconds: 3600 })
  @Post(':id/share')
  async generateShareLink(@Req() req: RequestWithUser, @Param('id') id: string) {
    return this.streakService.generateShareLink(req.user.userId, id);
  }
}
