import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CommunityChatGateway } from './live/community-chat.gateway';
import { CommunityMessageDto, ListCommunityMessagesResult } from './community-chat.types';
import {
  DEFAULT_COMMUNITY_MESSAGES_LIMIT,
  MAX_COMMUNITY_MESSAGES_LIMIT,
} from './dto/query-community-messages.dto';

// Deliberately narrower than user.service.ts's own SAFE_USER_SELECT (no
// email/role/totalPoints) — this projection is broadcast to every other
// connected user, not returned to the profile owner. Module-local, not
// exported/shared, same "each module owns its own" spirit as the rate-limit
// guards.
const SAFE_AUTHOR_SELECT = {
  id: true,
  name: true,
  avatarUrl: true,
  level: true,
} as const;

type CommunityMessageRow = Prisma.CommunityMessageGetPayload<{
  include: { user: { select: typeof SAFE_AUTHOR_SELECT } };
}>;

const toCommunityMessageDto = (row: CommunityMessageRow): CommunityMessageDto => ({
  id: row.id,
  content: row.content,
  clientMessageId: row.clientMessageId,
  createdAt: row.createdAt.toISOString(),
  author: {
    id: row.user.id,
    name: row.user.name,
    avatarUrl: row.user.avatarUrl,
    level: row.user.level,
  },
});

@Injectable()
export class CommunityChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: CommunityChatGateway,
  ) {}

  /**
   * Identity (userId) always comes from the caller's verified JWT — this
   * method never accepts one from a request body. Idempotent via the
   * table's `@@unique([userId, clientMessageId])`: a retried call with the
   * same pair returns the ORIGINAL row (never a duplicate, never an error),
   * and only the first successful insert broadcasts.
   */
  async sendMessage(
    userId: string,
    clientMessageId: string,
    content: string,
  ): Promise<CommunityMessageDto> {
    try {
      const row = await this.prisma.communityMessage.create({
        data: { userId, clientMessageId, content },
        include: { user: { select: SAFE_AUTHOR_SELECT } },
      });
      const dto = toCommunityMessageDto(row);
      this.gateway.broadcast(dto);
      return dto;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.prisma.communityMessage.findUnique({
          where: { userId_clientMessageId: { userId, clientMessageId } },
          include: { user: { select: SAFE_AUTHOR_SELECT } },
        });
        // The row that caused P2002 must exist by definition — this null
        // check is defensive typing, not a real branch.
        if (existing) return toCommunityMessageDto(existing);
      }
      throw error;
    }
  }

  /**
   * Cursor pagination (`before` = a message id, `limit` capped at
   * MAX_COMMUNITY_MESSAGES_LIMIT) rather than this codebase's usual
   * {page,limit} shape — a live-appending feed has no stable "page N", and
   * this is what "load older on scroll up" actually needs. Always returns
   * oldest→newest so the caller can prepend without re-sorting, on both the
   * initial load and every later page.
   */
  async listMessages(before?: string, limit?: number): Promise<ListCommunityMessagesResult> {
    const take = Math.min(limit ?? DEFAULT_COMMUNITY_MESSAGES_LIMIT, MAX_COMMUNITY_MESSAGES_LIMIT);

    let cursorWhere: Prisma.CommunityMessageWhereInput | undefined;
    if (before) {
      const cursorRow = await this.prisma.communityMessage.findUnique({
        where: { id: before },
        select: { createdAt: true, id: true },
      });
      // A `before` that doesn't resolve to a real row (stale client state —
      // there's no delete feature yet, so this is a paranoia guard, not a
      // realistic flow) returns an honest empty page, never a 404/500.
      if (!cursorRow) {
        return { data: [], meta: { hasMore: false, oldestId: null } };
      }
      cursorWhere = {
        OR: [
          { createdAt: { lt: cursorRow.createdAt } },
          { createdAt: cursorRow.createdAt, id: { lt: cursorRow.id } },
        ],
      };
    }

    // Fetch one extra row to compute hasMore without a second COUNT query —
    // if take+1 rows come back, trim the last one and report hasMore:true.
    const rows = await this.prisma.communityMessage.findMany({
      where: cursorWhere,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      include: { user: { select: SAFE_AUTHOR_SELECT } },
    });

    const hasMore = rows.length > take;
    const page = rows.slice(0, take);
    const oldestId = page.length > 0 ? page[page.length - 1].id : null;

    return {
      data: page.reverse().map(toCommunityMessageDto),
      meta: { hasMore, oldestId },
    };
  }
}
