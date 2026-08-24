import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { NotificationService } from './notification.service';

interface FakeNotification {
  id: string;
  userId: string;
  type: string;
  payload: unknown;
  readAt: Date | null;
  createdAt: Date;
}

let idCounter = 0;
const nextId = () => `notif-${(idCounter += 1)}`;

const buildHarness = () => {
  const rows: FakeNotification[] = [];

  const tx = {
    notification: {
      create: jest.fn(({ data }: { data: { userId: string; type: string; payload: unknown } }) => {
        rows.push({ id: nextId(), readAt: null, createdAt: new Date(), ...data });
        return Promise.resolve();
      }),
    },
  };

  const prisma = {
    notification: {
      findUnique: jest.fn(({ where: { id } }: { where: { id: string } }) =>
        Promise.resolve(rows.find((r) => r.id === id) ?? null),
      ),
      findMany: jest.fn(({ where }: { where: { userId: string } }) => {
        const matches = rows
          .filter((r) => r.userId === where.userId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return Promise.resolve(matches);
      }),
      count: jest.fn(({ where }: { where: { userId: string; readAt: null } }) =>
        Promise.resolve(rows.filter((r) => r.userId === where.userId && r.readAt === null).length),
      ),
      update: jest.fn(({ where: { id }, data }: { where: { id: string }; data: { readAt: Date } }) => {
        const row = rows.find((r) => r.id === id)!;
        row.readAt = data.readAt;
        return Promise.resolve(row);
      }),
      updateMany: jest.fn(({ where }: { where: { userId: string; readAt: null } }) => {
        const matches = rows.filter((r) => r.userId === where.userId && r.readAt === null);
        matches.forEach((r) => (r.readAt = new Date()));
        return Promise.resolve({ count: matches.length });
      }),
    },
  };

  const service = new NotificationService(prisma as never);
  return { service, prisma, tx, rows };
};

describe('NotificationService', () => {
  it('create() writes inside the caller-supplied transaction', async () => {
    const { service, tx, rows } = buildHarness();
    await service.create(tx as never, 'user-1', 'STREAK_MILESTONE', { days: 3 } as never);
    expect(tx.notification.create).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(1);
    expect(rows[0].readAt).toBeNull();
  });

  it('list() returns only the caller’s own notifications, newest first', async () => {
    const { service, tx } = buildHarness();
    await service.create(tx as never, 'user-1', 'STREAK_MILESTONE', {} as never);
    await service.create(tx as never, 'user-2', 'STREAK_MILESTONE', {} as never);
    const result = await service.list('user-1');
    expect(result.data).toHaveLength(1);
  });

  it('unreadCount() counts only unread rows for that user', async () => {
    const { service, tx } = buildHarness();
    await service.create(tx as never, 'user-1', 'STREAK_MILESTONE', {} as never);
    await service.create(tx as never, 'user-1', 'STREAK_BROKEN', {} as never);
    expect(await service.unreadCount('user-1')).toBe(2);
    const [{ id }] = (await service.list('user-1')).data;
    await service.markRead('user-1', id);
    expect(await service.unreadCount('user-1')).toBe(1);
  });

  it('markRead() rejects marking another user’s notification', async () => {
    const { service, tx } = buildHarness();
    await service.create(tx as never, 'user-1', 'STREAK_MILESTONE', {} as never);
    const [{ id }] = (await service.list('user-1')).data;
    await expect(service.markRead('user-2', id)).rejects.toThrow(ForbiddenException);
  });

  it('markRead() 404s for an unknown id', async () => {
    const { service } = buildHarness();
    await expect(service.markRead('user-1', 'nope')).rejects.toThrow(NotFoundException);
  });

  it('markAllRead() clears unread count for that user only', async () => {
    const { service, tx } = buildHarness();
    await service.create(tx as never, 'user-1', 'STREAK_MILESTONE', {} as never);
    await service.create(tx as never, 'user-1', 'STREAK_BROKEN', {} as never);
    await service.create(tx as never, 'user-2', 'STREAK_MILESTONE', {} as never);
    await service.markAllRead('user-1');
    expect(await service.unreadCount('user-1')).toBe(0);
    expect(await service.unreadCount('user-2')).toBe(1);
  });
});
