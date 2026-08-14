import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { DictionaryController } from './dictionary.controller';
import { DictionaryService } from './dictionary.service';
import { DictionaryCacheStore } from './dictionary-cache.store';
import { DICTIONARY_SOURCE_PROVIDER } from './dictionary-source.provider';
import { FreeDictionaryApiProvider } from './free-dictionary-api.provider';
import { VI_TRANSLATION_PROVIDER } from './vi-translation.provider';
import { GeminiViTranslationProvider } from './gemini-vi-translation.provider';
import { DictionaryRateLimitGuard } from './rate-limit/dictionary-rate-limit.guard';

// Floating Dictionary, Phase A. Wholly new, greenfield module — no reuse of
// LessonModule/VocabWordModule beyond reading VocabWord through PrismaModule
// directly (see dictionary.service.ts's tier 1).
//
// Imports ONLY PrismaModule, same reasoning as ListeningModule/
// GamificationModule: DictionaryRateLimitGuard needs nothing but Reflector
// and RateLimiterService, and AuthModule is @Global() and exports the
// latter — no need to import a whole other feature module just to reuse a
// forty-line guard.
@Module({
  imports: [PrismaModule],
  controllers: [DictionaryController],
  providers: [
    DictionaryService,
    DictionaryCacheStore,
    // Token-bound, not a bare class — same reasoning as every other
    // external/AI provider in this codebase: e2e and unit tests substitute
    // a fake without a real network/paid call.
    { provide: DICTIONARY_SOURCE_PROVIDER, useClass: FreeDictionaryApiProvider },
    { provide: VI_TRANSLATION_PROVIDER, useClass: GeminiViTranslationProvider },
    DictionaryRateLimitGuard,
  ],
})
export class DictionaryModule {}
