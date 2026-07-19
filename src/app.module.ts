import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import { SharedModule } from './shared/shared.module';
import { CourseModule } from './course/course.module';
import { LessonModule } from './lesson/lesson.module';
import { VocabLibraryModule } from './vocab-library/vocab-library.module';
import { VocabDeckModule } from './vocab-deck/vocab-deck.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    SharedModule,
    AuthModule,
    UserModule,
    CourseModule,
    LessonModule,
    VocabLibraryModule,
    VocabDeckModule,
  ],
})
export class AppModule {}
