import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request.type';
import { PrismaService } from '../prisma/prisma.service';
import { getProStatusAndTimeZone } from '../shared/subscription-status.util';
import { UsageQuotaService } from './usage-quota.service';

// 2026-09-16 pricing relaunch (Phase B) — read-only quota display for the
// "AI 17/20" style widget. Never increments (see UsageQuotaService.getStatus)
// — only checkAndIncrement, called from the feature endpoints themselves,
// ever consumes quota.
@UseGuards(JwtAuthGuard)
@Controller('usage')
export class UsageQuotaController {
  constructor(
    private readonly usageQuota: UsageQuotaService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('quota')
  async getQuota(@Req() req: AuthenticatedRequest) {
    const { isPro, timeZone } = await getProStatusAndTimeZone(
      this.prisma,
      req.user.userId,
    );
    return this.usageQuota.getStatus(req.user.userId, isPro, timeZone);
  }
}
