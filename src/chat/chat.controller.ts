import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards';
import { ChatRateLimitGuard } from './rate-limit/chat-rate-limit.guard';
import { ChatRateLimit } from './rate-limit/chat-rate-limits.decorator';
import { ChatService } from './chat.service';
import { SendChatMessageDto } from './dto/send-chat-message.dto';
import { ChatContextInput } from './chat-context.types';

interface RequestWithUser extends Request {
  user: { userId: string };
}

// SendChatMessageDto's `context` is a flat, validated shape (class-validator
// has no notion of a discriminated union); this is the one place it gets
// narrowed into ChatContextResolver's actual discriminated ChatContextInput.
// `resourceId` is guaranteed present here for LESSON/VOCAB_WORD by the DTO's
// own `@ValidateIf` — a request that lacked it never reaches this line.
const toContextInput = (dto: SendChatMessageDto['context']): ChatContextInput => {
  if (!dto || dto.type === 'GENERAL') return { type: 'GENERAL' };
  if (dto.type === 'LESSON') {
    return { type: 'LESSON', resourceId: dto.resourceId as string, stage: dto.stage };
  }
  return { type: 'VOCAB_WORD', resourceId: dto.resourceId as string };
};

// `main.ts` does not enable `transform` globally — this local pipe is what
// makes SendChatMessageDto's @Transform (trim) and nested @ValidateNested
// context actually run, same workaround Dictionary/Shadowing/Dictation use
// for their own body/query DTOs.
const bodyPipe = new ValidationPipe({ transform: true });

@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  /**
   * Identity comes ONLY from the verified JWT (`req.user.userId`) — a
   * `userId` field is never accepted from the request body. See
   * chat.service.ts for the placement-lock -> idempotency-claim ->
   * Gemini -> commit orchestration.
   */
  @UseGuards(JwtAuthGuard, ChatRateLimitGuard)
  @ChatRateLimit({ kind: 'message', max: 20, windowSeconds: 300 })
  @Post('messages')
  async sendMessage(@Req() req: RequestWithUser, @Body(bodyPipe) dto: SendChatMessageDto) {
    return this.chatService.sendMessage(
      req.user.userId,
      dto.clientMessageId,
      dto.message,
      toContextInput(dto.context),
    );
  }

  /** No rate limit — a cheap read, same convention as GET /dictionary/lookup's sibling reads. */
  @UseGuards(JwtAuthGuard)
  @Get('session')
  async getSession(@Req() req: RequestWithUser) {
    return this.chatService.getSession(req.user.userId);
  }

  /** Idempotent — clearing an already-empty/expired session is a no-op 204. */
  @UseGuards(JwtAuthGuard)
  @Delete('session')
  @HttpCode(HttpStatus.NO_CONTENT)
  async clearSession(@Req() req: RequestWithUser): Promise<void> {
    await this.chatService.clearSession(req.user.userId);
  }
}
