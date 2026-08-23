import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { IncomingMessage } from 'http';
import type WebSocket from 'ws';
import { RateLimiterService } from '../../auth/rate-limit/rate-limiter.service';
import { CommunityChatTicketStore } from './community-chat-ticket.store';
import { CommunityChatRateLimitKind } from '../rate-limit/community-chat-rate-limits.decorator';
import { CommunityMessageDto } from '../community-chat.types';

// Community Chat — the WebSocket entry point, /community/live. Thinner than
// SpeakingLiveGateway on purpose: there is no client→server frame at all.
// Sending a message is REST-only (POST /community/messages) — this socket
// exists solely to (a) authenticate a live connection via a one-shot ticket
// and (b) broadcast newly-persisted messages to everyone connected. Because
// nothing here ever reads anything the client sends after the handshake,
// there is no code path where a client could inject a fake
// userId/name/level/avatar over this socket — a structural guarantee, not a
// runtime check. That also means SpeakingLiveGateway's "buffer messages
// arriving before setup finishes" defense doesn't apply here: that defense
// exists purely to protect client-sent frames arriving early, and there are
// none.
//
// NO @UseGuards() HERE, same reason as SpeakingLiveGateway: `handleConnection`
// is a lifecycle hook, not a `@SubscribeMessage` route handler — NestJS
// guards don't wrap it. The ticket consume and the rate-limit check below
// are the actual guarantees.

const RATE_LIMIT_KIND: CommunityChatRateLimitKind = 'live-connect';
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_SECONDS = 600;

@WebSocketGateway({ path: '/community/live' })
export class CommunityChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(CommunityChatGateway.name);
  // A plain Set, not a Map: unlike SpeakingLiveGateway, there is no
  // per-connection state to store — a socket is either part of the
  // broadcast audience or it isn't.
  private readonly clients = new Set<WebSocket>();

  constructor(
    private readonly ticketStore: CommunityChatTicketStore,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  async handleConnection(client: WebSocket, request: IncomingMessage): Promise<void> {
    try {
      const ticket = this.extractTicket(request);
      if (!ticket) {
        client.close(4401, 'Missing ticket');
        return;
      }

      const claim = await this.ticketStore.consume(ticket);
      if (!claim) {
        client.close(4401, 'Invalid or expired ticket');
        return;
      }

      const limit = await this.rateLimiter.checkAndIncrement(
        `community:${RATE_LIMIT_KIND}:${claim.userId}`,
        RATE_LIMIT_MAX,
        RATE_LIMIT_WINDOW_SECONDS,
      );
      if (!limit.allowed) {
        client.close(4429, 'Too many Community Live connections');
        return;
      }

      this.clients.add(client);
      this.sendToClient(client, { type: 'connected' });
    } catch (error) {
      this.logger.warn('Failed to establish a Community Live connection', error as Error);
      client.close(4500, 'Could not start Community Live');
    }
  }

  handleDisconnect(client: WebSocket): void {
    this.clients.delete(client);
  }

  /** Called by CommunityChatService right after a message is durably persisted. */
  broadcast(message: CommunityMessageDto): void {
    const payload = JSON.stringify({ type: 'community:message:new', message });
    for (const client of this.clients) {
      if (client.readyState === client.OPEN) client.send(payload);
    }
  }

  private sendToClient(client: WebSocket, event: { type: string }): void {
    if (client.readyState !== client.OPEN) return;
    client.send(JSON.stringify(event));
  }

  /** Query param, not a header — WS handshakes give browsers no custom-header story. See the ticket store's own header for why this is a short-lived single-use ticket, never the real access JWT. */
  private extractTicket(request: IncomingMessage): string | null {
    if (!request.url) return null;
    const url = new URL(request.url, 'http://community-live.internal');
    return url.searchParams.get('ticket');
  }
}
