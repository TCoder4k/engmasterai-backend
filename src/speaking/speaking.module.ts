import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SpeakingCatalogController } from './speaking-catalog.controller';
import { SpeakingAttemptController } from './speaking-attempt.controller';
import { SpeakingTranslateController } from './speaking-translate.controller';
import { SpeakingAdminController } from './speaking-admin.controller';
import { SpeakingScenarioService } from './speaking-scenario.service';
import { SpeakingExerciseService } from './speaking-exercise.service';
import { SpeakingAttemptService } from './speaking-attempt.service';
import { SpeakingTranslateService } from './speaking-translate.service';
import { SpeakingSessionStore } from './speaking-session.store';
import { SPEAKING_TRANSLATE_PROVIDER } from './speaking-translate.provider';
import { GeminiSpeakingTranslateProvider } from './gemini-speaking-translate.provider';
import { SpeakingRateLimitGuard } from './rate-limit/speaking-rate-limit.guard';
import { SpeakingLiveGateway } from './live/speaking-live.gateway';
import { SpeakingLiveTicketStore } from './live/speaking-live-ticket.store';
import { SPEAKING_LIVE_CONNECTION_PROVIDER } from './live/speaking-live-connection.provider';
import { GeminiSpeakingLiveConnectionProvider } from './live/gemini-speaking-live-connection.provider';

// Speaking Partner — a separate learning domain, not part of ChatModule (a
// general tutor assistant) or ListeningModule's Shadowing (which grades
// against one correct reference sentence; Speaking has none).
//
// THE CONVERSATION ENGINE IS GEMINI LIVE, over /speaking/live
// (SpeakingLiveGateway, src/speaking/live/) — a persistent WebSocket, not a
// per-turn HTTP endpoint. The old STT→text-reply pipeline
// (SPEAKING_SPEECH_TO_TEXT_PROVIDER/SPEAKING_AI_PROVIDER,
// SpeakingIdempotencyStore, POST /attempts/:id/turns) is retired — see
// docs/CLAUDE.md's Speaking Live section for the full rationale.
//
// Imports ONLY PrismaModule, same reasoning as ChatModule/DictionaryModule/
// ListeningModule: SpeakingRateLimitGuard/SpeakingLiveGateway need nothing
// but Reflector and RateLimiterService, and AuthModule is @Global() and
// already exports the latter.
@Module({
  imports: [PrismaModule],
  controllers: [
    SpeakingCatalogController,
    SpeakingAttemptController,
    SpeakingTranslateController,
    SpeakingAdminController,
  ],
  providers: [
    SpeakingScenarioService,
    SpeakingExerciseService,
    SpeakingAttemptService,
    SpeakingTranslateService,
    SpeakingSessionStore,
    SpeakingLiveTicketStore,
    SpeakingLiveGateway,
    // Token-bound, not a bare class — e2e/unit tests substitute a fake
    // without a real network/paid call, same convention as every other
    // external/AI provider in this codebase.
    { provide: SPEAKING_TRANSLATE_PROVIDER, useClass: GeminiSpeakingTranslateProvider },
    { provide: SPEAKING_LIVE_CONNECTION_PROVIDER, useClass: GeminiSpeakingLiveConnectionProvider },
    SpeakingRateLimitGuard,
  ],
})
export class SpeakingModule {}
