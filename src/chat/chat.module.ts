import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatContextResolver } from './chat-context.resolver';
import { ChatSessionStore } from './chat-session.store';
import { ChatIdempotencyStore } from './chat-idempotency.store';
import { AssessmentLockService } from './assessment-lock.service';
import { ENGY_CHAT_PROVIDER } from './engy-chat.provider';
import { GeminiEngyChatProvider } from './gemini-engy-chat.provider';
import { ChatRateLimitGuard } from './rate-limit/chat-rate-limit.guard';

// Engy Chat, Phase B + Phase C. Wholly new, greenfield module — same
// reasoning as DictionaryModule (see its own header): imports ONLY
// PrismaModule (for AssessmentLockService's/ChatContextResolver's reads);
// AuthModule is @Global() and exports RateLimiterService already.
@Module({
  imports: [PrismaModule],
  controllers: [ChatController],
  providers: [
    ChatService,
    ChatContextResolver,
    ChatSessionStore,
    ChatIdempotencyStore,
    AssessmentLockService,
    // Token-bound, not a bare class — e2e/unit tests substitute a fake
    // without a real network/paid call, same convention as every other
    // external/AI provider in this codebase.
    { provide: ENGY_CHAT_PROVIDER, useClass: GeminiEngyChatProvider },
    ChatRateLimitGuard,
  ],
})
export class ChatModule {}
