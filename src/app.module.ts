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
  ],
})
export class AppModule {}
