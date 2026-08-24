import { Controller, Get, Param, Post, Query, Req, UseGuards, ValidationPipe } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards';
import { NotificationRateLimitGuard } from './rate-limit/notification-rate-limit.guard';
import { NotificationRateLimit } from './rate-limit/notification-rate-limits.decorator';
import { NotificationService } from './notification.service';
import { QueryNotificationsDto } from './dto/query-notifications.dto';

interface RequestWithUser extends Request {
  user: { userId: string };
}

// main.ts does not enable `transform` globally — same local-pipe workaround
// ChatController/CommunityChatController use for their own query DTOs.
const queryPipe = new ValidationPipe({ transform: true });

@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @UseGuards(JwtAuthGuard, NotificationRateLimitGuard)
  @NotificationRateLimit({ kind: 'read', max: 60, windowSeconds: 60 })
  @Get()
  async list(@Req() req: RequestWithUser, @Query(queryPipe) query: QueryNotificationsDto) {
    return this.notificationService.list(req.user.userId, query.before, query.limit);
  }

  @UseGuards(JwtAuthGuard, NotificationRateLimitGuard)
  @NotificationRateLimit({ kind: 'read', max: 60, windowSeconds: 60 })
  @Get('unread-count')
  async unreadCount(@Req() req: RequestWithUser) {
    return { count: await this.notificationService.unreadCount(req.user.userId) };
  }

  @UseGuards(JwtAuthGuard, NotificationRateLimitGuard)
  @NotificationRateLimit({ kind: 'write', max: 60, windowSeconds: 60 })
  @Post(':id/read')
  async markRead(@Req() req: RequestWithUser, @Param('id') id: string) {
    await this.notificationService.markRead(req.user.userId, id);
    return { success: true };
  }

  @UseGuards(JwtAuthGuard, NotificationRateLimitGuard)
  @NotificationRateLimit({ kind: 'write', max: 30, windowSeconds: 60 })
  @Post('read-all')
  async markAllRead(@Req() req: RequestWithUser) {
    await this.notificationService.markAllRead(req.user.userId);
    return { success: true };
  }
}
