import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import type { Request, Response } from 'express';
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

// One SSE frame: an `event:` line naming which of delta/done/error this is,
// one `data:` line carrying the JSON payload, and the blank-line terminator
// — matches exactly what shared/sse-frame-reader.ts (and chatService.ts on
// the frontend) parse back out. JSON never contains a raw newline, so a
// single `data:` line is always enough — no need for chatService.ts's
// resumption line-folding.
const sseFrame = (event: 'delta' | 'done' | 'error', data: unknown): string =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  /**
   * Identity comes ONLY from the verified JWT (`req.user.userId`) — a
   * `userId` field is never accepted from the request body.
   *
   * SSE, written manually via `@Res()` (2026-09-12, streaming rewrite) —
   * `@Sse()` is designed around GET routes; combining it with `@Post()` was
   * judged not worth the risk versus writing the wire format by hand. `@Res()`
   * does NOT disable Nest's exception filters: `prepareSend()` below is
   * awaited BEFORE anything is written to `res`, so any HttpException it
   * throws (400/403/404/409 — a bad context, the assessment lock, a
   * concurrent duplicate) still becomes a normal JSON error response exactly
   * as before. `@ChatRateLimit`'s guard runs before this method at all, so
   * 429 is unaffected too. Only ONCE we commit to streaming (`res.writeHead`)
   * is there no way back to a JSON error — see chat.service.ts's `streamReply`,
   * which reports failure as an OUTCOME rather than a throw for exactly this
   * reason.
   */
  @UseGuards(JwtAuthGuard, ChatRateLimitGuard)
  @ChatRateLimit({ kind: 'message', max: 20, windowSeconds: 300 })
  @Post('messages')
  async sendMessage(
    @Req() req: RequestWithUser,
    @Body(bodyPipe) dto: SendChatMessageDto,
    @Res() res: Response,
  ): Promise<void> {
    const prepared = await this.chatService.prepareSend(
      req.user.userId,
      dto.clientMessageId,
      dto.message,
      toContextInput(dto.context),
    );

    res.writeHead(HttpStatus.OK, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Tells a reverse proxy (e.g. Nginx) in front of this not to buffer
      // the response — buffering would defeat the whole point of streaming.
      'X-Accel-Buffering': 'no',
    });

    if (prepared.kind === 'replay') {
      res.write(sseFrame('done', prepared.result));
      res.end();
      return;
    }

    // prepared.kind === 'claimed' — about to call Gemini for real. If the
    // client's connection closes before this settles, cancel the in-flight
    // Gemini call and skip committing a reply nobody received (see
    // chat.service.ts's streamReply and docs/CLAUDE.md's disconnect note).
    const abortController = new AbortController();
    let finished = false;
    res.on('close', () => {
      if (!finished) abortController.abort();
    });

    const outcome = await this.chatService.streamReply(
      req.user.userId,
      dto.clientMessageId,
      dto.message,
      prepared.contextText,
      prepared.history,
      {
        signal: abortController.signal,
        onDelta: (text) => res.write(sseFrame('delta', { text })),
      },
    );

    if (outcome.kind === 'done') res.write(sseFrame('done', outcome.result));
    if (outcome.kind === 'error') {
      res.write(sseFrame('error', { message: 'Engy is temporarily unavailable' }));
    }
    // outcome.kind === 'aborted' — the connection is already gone; nothing to write.

    finished = true;
    res.end();
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
