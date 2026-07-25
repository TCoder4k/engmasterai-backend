import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { VocabWordModule } from '../vocab-word/vocab-word.module';
import { VocabDeckModule } from '../vocab-deck/vocab-deck.module';
import { VocabLibraryModule } from '../vocab-library/vocab-library.module';
import { LearningController } from './learning.controller';
import { LearningService } from './learning.service';
import { LearningEventLogger } from './logging/learning-event-logger.service';
import { LearningRateLimitGuard } from './rate-limit/learning-rate-limit.guard';

// RateLimiterService/JwtAuthGuard are not imported here — AuthModule is
// @Global() and already exports both (see auth.module.ts), so they resolve
// for LearningRateLimitGuard/the controller's guards without a new import,
// matching how JwtAuthGuard is used everywhere else in this codebase.
@Module({
  imports: [PrismaModule, VocabWordModule, VocabDeckModule, VocabLibraryModule],
  controllers: [LearningController],
  providers: [LearningService, LearningEventLogger, LearningRateLimitGuard],
})
export class LearningModule {}
