import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { assertLessonVisible } from './lesson-visibility';

const lesson = (orderIndex: number) => ({
  isPublished: true,
  orderIndex,
  course: { isPublished: true },
});

describe('assertLessonVisible Premium policy', () => {
  it('rejects a free user from a later lesson even when the lesson is published', async () => {
    const prisma = {
      lesson: { findUnique: jest.fn().mockResolvedValue(lesson(9)) },
      subscription: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    } as never;

    await expect(
      assertLessonVisible(prisma, 'lesson-10', 'free-user'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('keeps the free preview available', async () => {
    const prisma = {
      lesson: { findUnique: jest.fn().mockResolvedValue(lesson(2)) },
      subscription: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    } as never;

    await expect(
      assertLessonVisible(prisma, 'lesson-3', 'free-user'),
    ).resolves.toBeUndefined();
  });

  it('allows a currently active Premium subscription regardless of stored progress', async () => {
    const prisma = {
      lesson: { findUnique: jest.fn().mockResolvedValue(lesson(9)) },
      subscription: {
        findUnique: jest.fn().mockResolvedValue({
          plan: 'PREMIUM_MONTHLY',
          expiresAt: new Date(Date.now() + 86_400_000),
        }),
      },
    } as never;

    await expect(
      assertLessonVisible(prisma, 'lesson-10', 'premium-user'),
    ).resolves.toBeUndefined();
  });

  it('still hides unpublished lessons before entitlement is evaluated', async () => {
    const prisma = {
      lesson: { findUnique: jest.fn().mockResolvedValue(null) },
      subscription: { findUnique: jest.fn() },
    } as never;

    await expect(
      assertLessonVisible(prisma, 'missing', 'free-user'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
