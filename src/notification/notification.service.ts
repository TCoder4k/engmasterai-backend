import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Notification, NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationDto, NotificationPayload, ListNotificationsResult } from './notification.types';

export const DEFAULT_NOTIFICATIONS_LIMIT = 20;
export const MAX_NOTIFICATIONS_LIMIT = 50;

const toNotificationDto = (row: Notification): NotificationDto => ({
  id: row.id,
  type: row.type,
  payload: row.payload as unknown as NotificationPayload,
  read: row.readAt !== null,
  createdAt: row.createdAt.toISOString(),
});

@Injectable()
export class NotificationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * WRITE PATH — takes the caller's transaction, exactly like
   * GamificationService.recordProgress. Streak Together is the only caller
   * today (from inside StreakService's own transactions), so a notification
   * is always created atomically alongside the state change it describes —
   * never a fire-and-forget side effect that could silently disagree with
   * what actually happened.
   */
  async create(
    tx: Prisma.TransactionClient,
    userId: string,
    type: NotificationType,
    payload: NotificationPayload,
  ): Promise<void> {
    await tx.notification.create({
      data: { userId, type, payload: payload as unknown as Prisma.InputJsonValue },
    });
  }

  /** Cursor pagination, same shape as CommunityChatService.listMessages. */
  async list(userId: string, before?: string, limit?: number): Promise<ListNotificationsResult> {
    const take = Math.min(limit ?? DEFAULT_NOTIFICATIONS_LIMIT, MAX_NOTIFICATIONS_LIMIT);

    let cursorWhere: Prisma.NotificationWhereInput | undefined;
    if (before) {
      const cursorRow = await this.prisma.notification.findUnique({
        where: { id: before },
        select: { createdAt: true, id: true, userId: true },
      });
      if (!cursorRow || cursorRow.userId !== userId) {
        return { data: [], meta: { hasMore: false, oldestId: null } };
      }
      cursorWhere = {
        OR: [
          { createdAt: { lt: cursorRow.createdAt } },
          { createdAt: cursorRow.createdAt, id: { lt: cursorRow.id } },
        ],
      };
    }

    const rows = await this.prisma.notification.findMany({
      where: { userId, ...cursorWhere },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
    });

    const hasMore = rows.length > take;
    const page = rows.slice(0, take);
    const oldestId = page.length > 0 ? page[page.length - 1].id : null;

    return { data: page.map(toNotificationDto), meta: { hasMore, oldestId } };
  }

  async unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId, readAt: null } });
  }

  async markRead(userId: string, notificationId: string): Promise<void> {
    const row = await this.prisma.notification.findUnique({ where: { id: notificationId } });
    if (!row) throw new NotFoundException('Notification not found');
    if (row.userId !== userId) throw new ForbiddenException();
    if (row.readAt) return;
    await this.prisma.notification.update({
      where: { id: notificationId },
      data: { readAt: new Date() },
    });
  }

  async markAllRead(userId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
  }
}
