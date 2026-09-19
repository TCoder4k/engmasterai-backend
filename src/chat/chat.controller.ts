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
import { PrismaService } from '../prisma/prisma.service';
import { getProStatusAndTimeZone } from '../shared/subscription-status.util';
import { UsageQuotaService } from '../usage/usage-quota.service';
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
const toContextInput = (
  dto: SendChatMessageDto['context'],
): ChatContextInput => {
  if (!dto || dto.type === 'GENERAL') return { type: 'GENERAL' };
  if (dto.type === 'LESSON') {
    return {
      type: 'LESSON',
      resourceId: dto.resourceId as string,
      stage: dto.stage,
    };
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
  constructor(
    private readonly chatService: ChatService,
    private readonly usageQuota: UsageQuotaService,
    private readonly prisma: PrismaService,
  ) {}

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
    // 2026-09-16 pricing relaunch — gated by the "aiQuery" usage quota
    // (shared with Dictionary lookup). Checked BEFORE prepareSend()'s own
    // idempotency claim is taken, deliberately: prepareSend distinguishes a
    // brand-new send from a REPLAY of an already-completed clientMessageId
    // only once it runs, and throwing a quota exception AFTER a claim is
    // taken but before it's released would leak that claim. The accepted
    // cost is that a genuine retry-with-the-same-clientMessageId (rare — a
    // network blip, not a normal user action) consumes one extra quota unit
    // for a reply that doesn't call Gemini again; not worth the risk of
    // restructuring ChatService's own claim/replay logic to avoid it.
    const { isPro, timeZone } = await getProStatusAndTimeZone(
      this.prisma,
      req.user.userId,
    );
    await this.usageQuota.checkAndIncrement(
      req.user.userId,
      'aiQuery',
      isPro,
      timeZone,
    );

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
    // Node does NOT actually put the header block on the wire when
    // `writeHead()` is called — it only queues it, to be sent together with
    // the FIRST `res.write()`. Without this explicit flush, the frontend's
    // `fetch()` promise (which resolves once headers are received) would
    // stay pending until Gemini produces its first token, silently eating
    // into `fetchWithTimeout`'s 15s client-side budget on every slow reply
    // and intermittently failing fast ones for no visible reason. Flushing
    // here makes header delivery instant and independent of Gemini's speed,
    // matching chatService.ts's documented assumption.
    res.flushHeaders();

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
      res.write(
        sseFrame('error', { message: 'Engy is temporarily unavailable' }),
      );
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
