import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { UsageQuotaService } from './usage-quota.service';
import { UsageQuotaController } from './usage-quota.controller';

// 2026-09-16 pricing relaunch (Phase B). UsageQuotaService is exported so
// Dictionary/Chat/Listening(Shadowing)/Speaking can each inject it directly
// — no `/admin`-style prefix, no shared "billing" super-module; matches this
// codebase's existing convention of small, focused modules per real feature.
@Module({
  imports: [PrismaModule],
  providers: [UsageQuotaService],
  controllers: [UsageQuotaController],
  exports: [UsageQuotaService],
})
export class UsageModule {}
