import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

type PrismaLike = PrismaService | Prisma.TransactionClient;

/**
 * 2026-09-16 pricing relaunch (Phase C) — grants PRO days WITHOUT a Payment
 * row (lessons-completed milestone, referral reward). Mirrors
 * PaymentService.extendSubscriptionAtomically's exact atomic
 * `INSERT ... ON CONFLICT DO UPDATE SET "expiresAt" = GREATEST(...) + duration`
 * shape — the same reasoning applies here verbatim: two different grants (or
 * a grant racing a real payment) landing concurrently for the same user must
 * both extend the subscription, never overwrite one with the other via an
 * app-level read-then-write.
 *
 * Deliberately a SEPARATE method from PaymentService's own (private,
 * webhook-only) extendSubscriptionAtomically rather than reusing it: that
 * one's signature requires a real `Payment` row (`lastPaymentId` is written
 * from `payment.id`) and is intentionally private to the webhook flow. This
 * one never touches `plan` on an existing row (a bonus grant to an already-
 * PRO user should not silently "re-confirm" whatever plan they're on) and
 * leaves `lastPaymentId` untouched on conflict — it stays whatever a real
 * payment last set it to, or NULL if this account has never paid.
 */
@Injectable()
export class SubscriptionGrantService {
  async grantBonusDays(
    prisma: PrismaLike,
    userId: string,
    days: number,
  ): Promise<void> {
    const id = randomUUID();
    await prisma.$executeRaw`
      INSERT INTO subscriptions (id, "userId", plan, "startsAt", "expiresAt", "lastPaymentId", "createdAt", "updatedAt")
      VALUES (${id}, ${userId}, 'PRO_MONTHLY'::"SubscriptionPlan", NOW(), NOW() + (${days} * INTERVAL '1 day'), NULL, NOW(), NOW())
      ON CONFLICT ("userId") DO UPDATE SET
        "expiresAt" = GREATEST(subscriptions."expiresAt", NOW()) + (${days} * INTERVAL '1 day'),
        "updatedAt" = NOW()
    `;
  }
}
