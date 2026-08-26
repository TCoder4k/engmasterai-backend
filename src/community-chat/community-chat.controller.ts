import { Body, Controller, Get, Post, Query, Req, UseGuards, ValidationPipe } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards';
import { CommunityChatRateLimitGuard } from './rate-limit/community-chat-rate-limit.guard';
import { CommunityChatRateLimit } from './rate-limit/community-chat-rate-limits.decorator';
import { CommunityChatService } from './community-chat.service';
import { CommunityChatTicketStore } from './live/community-chat-ticket.store';
import { SendCommunityMessageDto } from './dto/send-community-message.dto';
import { QueryCommunityMessagesDto } from './dto/query-community-messages.dto';

interface RequestWithUser extends Request {
  user: { userId: string };
}

// main.ts does not enable `transform` globally — these local pipes are what
// make @Type(()=>Number) (query) and the DTOs' own @Transform (trim) run,
// same workaround ChatController/VocabWordController use for their own
// body/query DTOs.
const bodyPipe = new ValidationPipe({ transform: true });
const queryPipe = new ValidationPipe({ transform: true });

@Controller('community')
export class CommunityChatController {
  constructor(
    private readonly communityChatService: CommunityChatService,
    private readonly ticketStore: CommunityChatTicketStore,
  ) {}

  /** No rate-limit-worthy cost beyond the `read` bucket — a cheap paginated read. */
  @UseGuards(JwtAuthGuard, CommunityChatRateLimitGuard)
  @CommunityChatRateLimit({ kind: 'read', max: 60, windowSeconds: 60 })
  @Get('messages')
  async listMessages(@Query(queryPipe) query: QueryCommunityMessagesDto) {
    return this.communityChatService.listMessages(query.before, query.limit);
  }

  /**
   * Identity comes ONLY from the verified JWT (`req.user.userId`) — the DTO
   * has no `userId` field at all, so a client can never supply its own
   * sender identity, by construction.
   */
  @UseGuards(JwtAuthGuard, CommunityChatRateLimitGuard)
  @CommunityChatRateLimit({ kind: 'send', max: 20, windowSeconds: 60 })
  @Post('messages')
  async sendMessage(@Req() req: RequestWithUser, @Body(bodyPipe) dto: SendCommunityMessageDto) {
    return this.communityChatService.sendMessage(req.user.userId, dto.clientMessageId, dto.content);
  }

  /** No rate-limit-worthy cost beyond the `read` bucket — a cheap count query. */
  @UseGuards(JwtAuthGuard, CommunityChatRateLimitGuard)
  @CommunityChatRateLimit({ kind: 'read', max: 60, windowSeconds: 60 })
  @Get('messages/unread-count')
  async unreadCount(@Req() req: RequestWithUser) {
    return { count: await this.communityChatService.unreadCount(req.user.userId) };
  }

  /**
   * Own `markRead` kind, separate from `read` — the frontend fires this more
   * often than a plain read (on tab activation and, debounced, on every live
   * incoming message while the tab is open), and it must not compete with
   * GET /community/messages's own budget.
   */
  @UseGuards(JwtAuthGuard, CommunityChatRateLimitGuard)
  @CommunityChatRateLimit({ kind: 'markRead', max: 60, windowSeconds: 60 })
  @Post('messages/read')
  async markRead(@Req() req: RequestWithUser) {
    await this.communityChatService.markRead(req.user.userId);
    return { success: true };
  }

  /**
   * Issues a short-lived, single-use ticket for the /community/live
   * WebSocket handshake (see live/community-chat-ticket.store.ts). No
   * dedicated rate-limit kind: the ticket itself is cheap and self-expiring
   * (45s TTL); the real cost — an actual connection — is already capped by
   * the gateway's own `live-connect` check.
   */
  @UseGuards(JwtAuthGuard)
  @Post('live-ticket')
  async issueLiveTicket(@Req() req: RequestWithUser) {
    const ticket = await this.ticketStore.issue(req.user.userId);
    return { ticket };
  }
}
