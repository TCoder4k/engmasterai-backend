import { Inject, Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { IncomingMessage } from 'http';
import type WebSocket from 'ws';
import { RateLimiterService } from '../../auth/rate-limit/rate-limiter.service';
import { SpeakingAttemptService } from '../speaking-attempt.service';
import { SpeakingSessionStore } from '../speaking-session.store';
import { SpeakingLiveTicketStore } from './speaking-live-ticket.store';
import { SPEAKING_LIVE_CONNECTION_PROVIDER } from './speaking-live-connection.provider';
// `import type` because this is injected by TOKEN, not by class: with
// `emitDecoratorMetadata` a value import here would make TypeScript emit a
// runtime reference to an interface that does not exist at runtime — same
// fix speaking-attempt.service.ts already applies to its own token-injected
// interfaces.
import type { SpeakingLiveConnectionProvider } from './speaking-live-connection.provider';
import { SpeakingLiveServerEvent, SpeakingLiveSession } from './speaking-live-session';
import { SpeakingRateLimitKind } from '../rate-limit/speaking-rate-limits.decorator';

// Speaking Partner Live — the WebSocket entry point, /speaking/live. This
// gateway is thin on purpose: everything correctness-sensitive (the
// transcript accumulator, exactly-once finalization) lives in
// SpeakingLiveSession, tested in isolation with no real socket or Gemini
// call — see that file. This class's only jobs are: authenticate the
// handshake via a one-shot ticket (not a JWT in the URL — see
// speaking-live-ticket.store.ts), rate-limit new connections, load the
// exercise persona, wire a fresh SpeakingLiveSession to this one socket,
// and shuttle JSON frames back and forth.
//
// NO @UseGuards() HERE. `handleConnection` is a gateway lifecycle hook, not
// a `@SubscribeMessage` route handler — NestJS guards don't wrap it the way
// they wrap HTTP routes. The ticket consume and the rate-limit check below
// are the actual guarantees; there's no framework-level guard to lean on
// for a raw WS handshake.

const RATE_LIMIT_KIND: SpeakingRateLimitKind = 'live-connect';
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_SECONDS = 600;

interface ClientMessage {
  type: 'activityStart' | 'audioChunk' | 'activityEnd';
  data?: string;
}

@WebSocketGateway({ path: '/speaking/live' })
export class SpeakingLiveGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(SpeakingLiveGateway.name);
  private readonly sessions = new Map<WebSocket, SpeakingLiveSession>();

  constructor(
    private readonly ticketStore: SpeakingLiveTicketStore,
    private readonly attemptService: SpeakingAttemptService,
    private readonly sessionStore: SpeakingSessionStore,
    private readonly rateLimiter: RateLimiterService,
    @Inject(SPEAKING_LIVE_CONNECTION_PROVIDER)
    private readonly connectionProvider: SpeakingLiveConnectionProvider,
  ) {}

  async handleConnection(client: WebSocket, request: IncomingMessage): Promise<void> {
    // BUFFER, DON'T DROP. The transport-level 'open' event fires on the
    // client the instant the handshake completes — before this handler has
    // even reached its first `await` below (ticket consume, rate limit, the
    // exercise lookup). A student's frontend can legitimately send
    // activityStart/audio the moment its socket opens; if this method only
    // attached its real listener AFTER all that async setup, anything sent
    // in that window would be silently lost (Node's EventEmitter does not
    // queue events for a listener that isn't registered yet). So: listen
    // synchronously, right now, buffer everything, and replay it in order
    // once the real session exists.
    const pending: WebSocket.RawData[] = [];
    const bufferMessage = (raw: WebSocket.RawData) => pending.push(raw);
    client.on('message', bufferMessage);

    const ticket = this.extractTicket(request);
    if (!ticket) {
      client.off('message', bufferMessage);
      client.close(4401, 'Missing ticket');
      return;
    }

    const claim = await this.ticketStore.consume(ticket);
    if (!claim) {
      client.off('message', bufferMessage);
      client.close(4401, 'Invalid or expired ticket');
      return;
    }

    const limit = await this.rateLimiter.checkAndIncrement(
      `speaking:${RATE_LIMIT_KIND}:${claim.userId}`,
      RATE_LIMIT_MAX,
      RATE_LIMIT_WINDOW_SECONDS,
    );
    if (!limit.allowed) {
      client.off('message', bufferMessage);
      client.close(4429, 'Too many Speaking Live connections');
      return;
    }

    const exercise = await this.attemptService.loadLiveContext(claim.userId, claim.attemptId);
    if (!exercise) {
      client.off('message', bufferMessage);
      client.close(4404, 'Attempt not found');
      return;
    }

    const session = new SpeakingLiveSession(
      claim.userId,
      claim.attemptId,
      exercise,
      this.connectionProvider,
      this.sessionStore,
      (event) => this.sendToClient(client, event),
    );

    try {
      await session.start();
    } catch (error) {
      client.off('message', bufferMessage);
      this.logger.warn('Failed to start a Speaking Live session', error as Error);
      client.close(4500, 'Could not start Speaking Live');
      return;
    }

    this.sessions.set(client, session);
    client.off('message', bufferMessage);
    client.on('message', (raw) => this.handleClientMessage(session, raw));
    // Replay anything the client sent while setup was still in flight, in
    // the order it arrived — see this method's own header comment.
    for (const raw of pending) this.handleClientMessage(session, raw);
  }

  handleDisconnect(client: WebSocket): void {
    const session = this.sessions.get(client);
    if (!session) return;
    this.sessions.delete(client);
    session.close();
  }

  private handleClientMessage(session: SpeakingLiveSession, raw: WebSocket.RawData): void {
    let message: ClientMessage;
    try {
      message = JSON.parse(raw.toString()) as ClientMessage;
    } catch {
      return; // malformed frame — ignored, not a reason to tear down the connection
    }

    switch (message.type) {
      case 'activityStart':
        session.handleActivityStart();
        break;
      case 'audioChunk':
        if (typeof message.data === 'string') session.handleAudioChunk(message.data);
        break;
      case 'activityEnd':
        session.handleActivityEnd();
        break;
    }
  }

  private sendToClient(client: WebSocket, event: SpeakingLiveServerEvent): void {
    if (client.readyState !== client.OPEN) return;
    client.send(JSON.stringify(event));
  }

  /** Query param, not a header — WS handshakes give browsers no custom-header story. See the ticket store's own header for why this is a short-lived single-use ticket, never the real access JWT. */
  private extractTicket(request: IncomingMessage): string | null {
    if (!request.url) return null;
    const url = new URL(request.url, 'http://speaking-live.internal');
    return url.searchParams.get('ticket');
  }
}
