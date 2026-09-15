import { Module } from '@nestjs/common';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { AdminStudentOverviewService } from './admin-student-overview.service';
import { PrismaModule } from '../prisma/prisma.module';
import { SharedModule } from '../shared/shared.module';
import { LessonModule } from '../lesson/lesson.module';
import { AnalyticsModule } from '../analytics/analytics.module';

@Module({
  // LessonModule (CourseProgressService) and AnalyticsModule
  // (DashboardAnalyticsService) are Sprint 15 (Admin student management)
  // additions — neither imports UserModule, so this introduces no circular
  // dependency. AuthModule's RefreshTokenService needs no import here: per
  // auth.module.ts's own convention, AuthModule is @Global() and every
  // exported provider resolves from any module's DI scope without it.
  imports: [PrismaModule, SharedModule, LessonModule, AnalyticsModule],
  controllers: [UserController],
  providers: [UserService, AdminStudentOverviewService],
  exports: [UserService],
})
export class UserModule {}
