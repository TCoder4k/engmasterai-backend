import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationModule } from '../notification/notification.module';
import { StreakController } from './streak.controller';
import { StreakService } from './streak.service';
import { StreakRateLimitGuard } from './rate-limit/streak-rate-limit.guard';

// Streak Together ("Chuỗi học cùng nhau") — see StreakService's own header
// for the module's design (canonical pair ordering, lazy recompute, the
// onUserActivityDay hook).
//
// Imports PrismaModule (not global) and NotificationModule (to create
// notifications inside its own transactions). AuthModule/SharedRedisModule
// are @Global(), so StreakRateLimitGuard needs no explicit import for
// Reflector/RateLimiterService.
//
// Exported so GamificationModule can import this module and inject
// StreakService directly into GamificationService's recordProgress —
// StreakModule itself imports nothing from GamificationModule, so this is
// a one-directional dependency, not a cycle.
@Module({
  imports: [PrismaModule, NotificationModule],
  controllers: [StreakController],
  providers: [StreakService, StreakRateLimitGuard],
  exports: [StreakService],
})
export class StreakModule {}
