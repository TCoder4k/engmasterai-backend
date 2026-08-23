import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CommunityChatController } from './community-chat.controller';
import { CommunityChatService } from './community-chat.service';
import { CommunityChatRateLimitGuard } from './rate-limit/community-chat-rate-limit.guard';
import { CommunityChatGateway } from './live/community-chat.gateway';
import { CommunityChatTicketStore } from './live/community-chat-ticket.store';

// Community Chat ("Tán gẫu") — a separate domain from ChatModule (Engy AI):
// User -> Backend -> Postgres -> WebSocket -> Users, never User -> Gemini.
// No shared service/API/data layer with Engy Chat, only the frontend's
// outer launcher/panel container.
//
// Imports ONLY PrismaModule, same reasoning as ChatModule/SpeakingModule:
// CommunityChatRateLimitGuard/CommunityChatGateway need nothing but
// Reflector and RateLimiterService, and AuthModule/SharedRedisModule are
// both @Global().
@Module({
  imports: [PrismaModule],
  controllers: [CommunityChatController],
  providers: [
    CommunityChatService,
    CommunityChatGateway,
    CommunityChatTicketStore,
    CommunityChatRateLimitGuard,
  ],
})
export class CommunityChatModule {}
