import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PaymentModule } from '../payment/payment.module';
import { ReferralService } from './referral.service';
import { ReferralController } from './referral.controller';

// 2026-09-16 pricing relaunch (Phase C). PaymentModule imports only
// PrismaModule, so this direction is safe (same reasoning as
// LessonModule's own PaymentModule import). Exported so GamificationModule
// can call onUserActivityDay from the same isNewDay gate StreakService uses
// — GamificationModule must never import LessonModule back, and this module
// mirrors that same one-way-edge discipline (imports nothing that could
// cycle to it).
@Module({
  imports: [PrismaModule, PaymentModule],
  controllers: [ReferralController],
  providers: [ReferralService],
  exports: [ReferralService],
})
export class ReferralModule {}
