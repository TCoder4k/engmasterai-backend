import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { NotificationRateLimitGuard } from './rate-limit/notification-rate-limit.guard';

// The first real notification system in this codebase — see
// NotificationService's own header. Imports ONLY PrismaModule:
// NotificationRateLimitGuard needs nothing but Reflector and
// RateLimiterService, and AuthModule is @Global() and exports the latter.
//
// Exported so StreakModule (the only writer today) can inject
// NotificationService directly and create notifications inside its own
// transactions.
@Module({
  imports: [PrismaModule],
  controllers: [NotificationController],
  providers: [NotificationService, NotificationRateLimitGuard],
  exports: [NotificationService],
})
export class NotificationModule {}
