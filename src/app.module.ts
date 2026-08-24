import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import { SharedModule } from './shared/shared.module';
import { SharedRedisModule } from './shared/redis/redis.module';
import { CourseModule } from './course/course.module';
import { LessonModule } from './lesson/lesson.module';
import { VocabLibraryModule } from './vocab-library/vocab-library.module';
import { VocabDeckModule } from './vocab-deck/vocab-deck.module';
import { VocabWordModule } from './vocab-word/vocab-word.module';
import { LearningModule } from './learning/learning.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { GamificationModule } from './gamification/gamification.module';
import { StudyTimeModule } from './study-time/study-time.module';
import { ListeningModule } from './listening/listening.module';
import { PlacementModule } from './placement/placement.module';
import { DictionaryModule } from './dictionary/dictionary.module';
import { ChatModule } from './chat/chat.module';
import { CommunityChatModule } from './community-chat/community-chat.module';
import { SpeakingModule } from './speaking/speaking.module';
import { HealthModule } from './health/health.module';
import { NotificationModule } from './notification/notification.module';
import { StreakModule } from './streak/streak.module';
import { envValidationSchema } from './config/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      validationOptions: { abortEarly: false, allowUnknown: true },
    }),
    PrismaModule,
    SharedModule,
    SharedRedisModule,
    AuthModule,
    UserModule,
    CourseModule,
    LessonModule,
    VocabLibraryModule,
    VocabDeckModule,
    VocabWordModule,
    LearningModule,
    AnalyticsModule,
    GamificationModule,
    StudyTimeModule,
    ListeningModule,
    PlacementModule,
    DictionaryModule,
    ChatModule,
    CommunityChatModule,
    SpeakingModule,
    HealthModule,
    NotificationModule,
    StreakModule,
  ],
})
export class AppModule {}
