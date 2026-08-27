import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { VocabPersonalController } from './vocab-personal.controller';
import { VocabPersonalService } from './vocab-personal.service';
import { VocabPersonalRateLimitGuard } from './rate-limit/vocab-personal-rate-limit.guard';

// A new top-level module, mirroring study-time.module.ts's minimal shape.
//
// WHY TOP-LEVEL. "Từ vựng của tôi" composes none of the curated-deck
// engine's collectors — it writes its own table and reads nothing from
// VocabWord/VocabDeck/VocabLibrary/Learning. It reuses the SRS scheduling
// ALGORITHM (src/learning/srs/scheduler.ts's next(), a pure function with
// no NestJS dependency) via a plain import, and the timezone/day-window
// helpers the same way — none of that requires importing LearningModule or
// AnalyticsModule.
//
// VocabPersonalRateLimitGuard is declared as a PROVIDER, not obtained via a
// shared module — same pattern StudyTimeModule/GamificationModule use for
// their own local guards: it needs only Reflector and RateLimiterService,
// and AuthModule is @Global() and exports the latter.
@Module({
  imports: [PrismaModule],
  controllers: [VocabPersonalController],
  providers: [VocabPersonalService, VocabPersonalRateLimitGuard],
})
export class VocabPersonalModule {}
