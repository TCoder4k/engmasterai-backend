import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { formatDayInTimeZone } from '../analytics/day-window';
import { UsageQuotaExceededException } from './usage-quota.exceptions';
import {
  USAGE_QUOTA_CONFIG,
  UsageKind,
  UsageQuotaStatus,
} from './usage-quota.types';

/**
 * Postgres-backed product usage quotas (2026-09-16 pricing relaunch, Phase
 * B) — see the UsageCounter model's own schema comment for why this is
 * deliberately NOT built on RateLimiterService/Redis (that primitive is a
 * short abuse-prevention window with no calendar-period concept and nothing
 * to read back for a "17/20 used" display).
 *
 * One row per user per kind per calendar period. Incremented via a single
 * atomic `INSERT ... ON CONFLICT DO UPDATE ... WHERE count < limit
 * RETURNING count` statement — mirrors PaymentService.extendSubscriptionAtomically's
 * exact reasoning (a read-then-write here would let two concurrent requests
 * at the last remaining unit both succeed). `isPro` is always the caller's
 * responsibility to derive fresh (never trust a JWT claim) — same
 * discipline as VocabPersonalService.isUserPro.
 */
@Injectable()
export class UsageQuotaService {
  constructor(private readonly prisma: PrismaService) {}

  private periodKeyFor(kind: UsageKind, timeZone: string): string {
    const dayLabel = formatDayInTimeZone(new Date(), timeZone);
    const period = USAGE_QUOTA_CONFIG[kind].period;
    return period === 'day' ? dayLabel : dayLabel.slice(0, 7);
  }

  /**
   * Atomically records one unit of usage and enforces the limit in the same
   * statement. Throws UsageQuotaExceededException (403) without recording
   * anything if the caller is already at/over their limit for this period —
   * a rejected attempt never consumes quota.
   */
  async checkAndIncrement(
    userId: string,
    kind: UsageKind,
    isPro: boolean,
    timeZone: string,
  ): Promise<UsageQuotaStatus> {
    const config = USAGE_QUOTA_CONFIG[kind];
    const limit = isPro ? config.pro : config.free;
    const periodKey = this.periodKeyFor(kind, timeZone);
    const id = randomUUID();

    const rows = await this.prisma.$queryRaw<{ count: number }[]>`
      INSERT INTO usage_counters (id, "userId", kind, "periodKey", count, "createdAt", "updatedAt")
      VALUES (${id}, ${userId}, ${kind}, ${periodKey}, 1, NOW(), NOW())
      ON CONFLICT ("userId", kind, "periodKey") DO UPDATE SET
        count = usage_counters.count + 1,
        "updatedAt" = NOW()
      WHERE usage_counters.count < ${limit}
      RETURNING count
    `;

    if (rows.length === 0) {
      const current = await this.prisma.usageCounter.findUnique({
        where: { userId_kind_periodKey: { userId, kind, periodKey } },
        select: { count: true },
      });
      throw new UsageQuotaExceededException(
        kind,
        current?.count ?? limit,
        limit,
        isPro,
      );
    }

    return {
      kind,
      used: rows[0].count,
      limit,
      period: config.period,
      periodKey,
    };
  }

  /** Read-only — for the frontend's "AI 17/20" display. Never increments. */
  async getStatus(
    userId: string,
    isPro: boolean,
    timeZone: string,
  ): Promise<UsageQuotaStatus[]> {
    const kinds = Object.keys(USAGE_QUOTA_CONFIG) as UsageKind[];
    const periodKeys = kinds.map((kind) => this.periodKeyFor(kind, timeZone));

    const rows = await this.prisma.usageCounter.findMany({
      where: {
        userId,
        OR: kinds.map((kind, i) => ({ kind, periodKey: periodKeys[i] })),
      },
      select: { kind: true, periodKey: true, count: true },
    });
    const byKey = new Map(
      rows.map((r) => [`${r.kind}:${r.periodKey}`, r.count]),
    );

    return kinds.map((kind, i) => {
      const config = USAGE_QUOTA_CONFIG[kind];
      return {
        kind,
        used: byKey.get(`${kind}:${periodKeys[i]}`) ?? 0,
        limit: isPro ? config.pro : config.free,
        period: config.period,
        periodKey: periodKeys[i],
      };
    });
  }
}
