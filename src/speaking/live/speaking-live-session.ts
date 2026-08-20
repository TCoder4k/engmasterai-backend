import { Logger } from '@nestjs/common';
import { SpeakingSessionStore } from '../speaking-session.store';
import {
  SpeakingLiveConnectionHandle,
  SpeakingLiveConnectionProvider,
  SpeakingLiveServerMessage,
} from './speaking-live-connection.provider';
import { SpeakingAiExerciseContext } from '../speaking.types';
import { buildSpeakingLiveOpeningCue, buildSpeakingLiveSystemInstruction } from './speaking-live-instruction';
import { SpeakingLiveAudioDiagnostics } from './speaking-live-audio-diagnostics';

// Speaking Partner Live — one instance per WebSocket connection, i.e. per
// conversation. DELIBERATELY A PLAIN CLASS, NOT A NestJS `@Injectable()`
// singleton: it holds mutable, per-conversation state (the transcript
// accumulators, the turn phase below), and a NestJS provider is a
// process-wide singleton by default — sharing ONE instance's state across
// every student's concurrent conversation would be a correctness bug, not
// a style choice. SpeakingLiveGateway (the real NestJS singleton) `new`s one
// of these per accepted connection and keeps it in a Map keyed by the
// socket, exactly the same "singleton gateway, per-connection plain object"
// shape NestJS's own WS docs use for this class of problem.
//
// >>> THE ACCUMULATOR CONTRACT, READ THIS BEFORE TOUCHING finalizeTurn() <<<
// A verification spike (throwaway script, logged against a REAL Live
// session before this file was written — see the plan/commit history, not
// guessed) confirmed `inputTranscription.text` / `outputTranscription.text`
// arrive as INCREMENTAL DELTAS, one per message — concatenating them in
// arrival order reconstructs the full sentence. combine() below is that
// confirmed behaviour, not an assumption. The Live API's own reference docs
// separately warn transcription messages have "no guaranteed ordering"
// relative to other server content — there is no sequence token to correct
// for that, so in-arrival-order concatenation is the best achievable
// correctness, not a shortcut.
//
// FINALIZATION IS EXACTLY-ONCE, GUARDED BY `phase`, NOT BY A SEPARATE FLAG.
// `phase` starts 'idle' after connect, immediately moves to 'opening' (see
// `triggerOpeningLine()` below — the cued opening-line turn), then to
// 'active' on activityStart (which also resets both accumulators), and only
// `finalizeTurn()`/`finalizeOpening()` — fired by `turnComplete` — moves it
// back to 'idle'. A duplicate/out-of-order `turnComplete` for the same turn
// is therefore a no-op: `phase` has already moved on, so it can't append a
// second time or double-count `turnCount`. This is the direct replacement
// for what SpeakingIdempotencyStore used to guarantee for the old
// discrete-POST model — sufficient here because a single stateful
// connection has no independent-retry surface the way separate HTTP
// requests did.
//
// 'opening' IS A REAL PHASE, NOT JUST A COMMENT. `handleActivityStart()`
// bails unless `phase === 'idle'`, so the student's mic (gated client-side
// on receiving `openingReady`) can't open a real turn while Gemini is still
// generating the opening line's audio, and a stray activityStart can't
// reset the opening accumulators mid-flight either.
//
// A TURN THAT NEVER FINALIZES SIMPLY NEVER WRITES ANYTHING. Empty
// transcript on turnComplete, a Gemini error mid-turn, or the socket
// disconnecting mid-turn all take the same path: discard the in-flight
// accumulators, never call `sessionStore.appendTurn`. `turnCount` is
// derived from `SpeakingSessionStore` at complete() exactly like the old
// pipeline — a turn that was never appended simply never counts, no
// separate bookkeeping needed.
//
// A GEMINI-SIDE ERROR OR CLOSE ENDS THE WHOLE CONVERSATION, NOT JUST ONE
// TURN. This is a Live MVP, not a production-hardened one — session
// resumption past a dropped connection is explicitly out of scope for this
// pass (see docs/CLAUDE.md's Speaking Live "Known limitation"). Treating a
// transport-level error as recoverable-for-just-this-turn would be a lie
// about what this code actually does.

export const combine = (previous: string, incoming: string): string => previous + incoming;

export type SpeakingLiveServerEvent =
  | { type: 'audioChunk'; data: string }
  | { type: 'turnFinalized'; userText: string; aiText: string }
  | { type: 'turnEmpty' }
  | { type: 'turnError' }
  | { type: 'interrupted' }
  | { type: 'sessionClosed'; reason: string }
  /** The cued opening line finished streaming — the client's mic gate opens now. No transcript, never persisted, never counts as a turn. */
  | { type: 'openingReady' };

type TurnPhase = 'idle' | 'opening' | 'active';

export class SpeakingLiveSession {
  private readonly logger = new Logger(SpeakingLiveSession.name);
  private connection: SpeakingLiveConnectionHandle | null = null;
  private phase: TurnPhase = 'idle';
  private currentUserTranscript = '';
  private currentAiTranscript = '';
  /** True once close()/a fatal Gemini error has run — guards against acting on a stray event afterward. */
  private ended = false;
  /** TEMPORARY diagnostic tool, off unless SPEAKING_LIVE_AUDIO_DEBUG_DUMP is set — see that file's own header. */
  private readonly audioDiagnostics = new SpeakingLiveAudioDiagnostics();

  constructor(
    private readonly userId: string,
    private readonly attemptId: string,
    private readonly exercise: SpeakingAiExerciseContext,
    private readonly connectionProvider: SpeakingLiveConnectionProvider,
    private readonly sessionStore: SpeakingSessionStore,
    private readonly sendToClient: (event: SpeakingLiveServerEvent) => void,
  ) {}

  async start(): Promise<void> {
    this.connection = await this.connectionProvider.connect({
      systemInstruction: buildSpeakingLiveSystemInstruction(this.exercise),
      callbacks: {
        onmessage: (message) => this.handleLiveMessage(message),
        onerror: (error) => this.handleFatal(`error: ${error.message}`),
        onclose: () => this.handleFatal('closed'),
      },
    });
    this.triggerOpeningLine();
  }

  /** Cues Gemini to speak the authored opening line as its first generated turn — see speaking-live-instruction.ts's header for why this replaced browser TTS for the greeting. */
  private triggerOpeningLine(): void {
    if (this.ended || !this.connection) return;
    this.phase = 'opening';
    this.currentUserTranscript = '';
    this.currentAiTranscript = '';
    this.connection.sendClientTurn(buildSpeakingLiveOpeningCue(this.exercise.openingLine));
  }

  /** Tap-start: begin a new turn, forward to Gemini, reset both accumulators. Blocked while the opening line is still generating or a turn is already active. */
  handleActivityStart(): void {
    if (this.ended || !this.connection || this.phase !== 'idle') return;
    this.phase = 'active';
    this.currentUserTranscript = '';
    this.currentAiTranscript = '';
    this.audioDiagnostics.reset();
    this.connection.sendRealtimeInput({ activityStart: {} });
  }

  /** One base64-encoded 16kHz PCM16 chunk, forwarded as-is while a turn is active. */
  handleAudioChunk(base64Pcm16: string): void {
    if (this.ended || !this.connection || this.phase !== 'active') return;
    this.audioDiagnostics.record(base64Pcm16);
    this.connection.sendRealtimeInput({
      audio: { data: base64Pcm16, mimeType: 'audio/pcm;rate=16000' },
    });
  }

  /** Tap-stop: signal end of speech. Gemini's reply (and turnComplete) follow asynchronously. */
  handleActivityEnd(): void {
    if (this.ended || !this.connection || this.phase !== 'active') return;
    this.connection.sendRealtimeInput({ activityEnd: {} });
  }

  /** Client disconnected — discard any in-flight turn and tear down the Gemini side. */
  close(): void {
    if (this.ended) return;
    this.ended = true;
    this.phase = 'idle';
    this.currentUserTranscript = '';
    this.currentAiTranscript = '';
    this.audioDiagnostics.reset();
    this.connection?.close();
  }

  private handleLiveMessage(message: SpeakingLiveServerMessage): void {
    if (this.ended) return;
    const sc = message.serverContent;
    if (!sc) return;

    if (sc.inputTranscription) {
      this.currentUserTranscript = combine(this.currentUserTranscript, sc.inputTranscription.text);
    }
    if (sc.outputTranscription) {
      this.currentAiTranscript = combine(this.currentAiTranscript, sc.outputTranscription.text);
    }
    if (sc.modelTurn?.parts) {
      for (const part of sc.modelTurn.parts) {
        if (part.inlineData?.data) {
          this.sendToClient({ type: 'audioChunk', data: part.inlineData.data });
        }
      }
    }
    if (sc.interrupted) {
      this.sendToClient({ type: 'interrupted' });
    }
    if (sc.turnComplete) {
      if (this.phase === 'opening') {
        this.finalizeOpening();
      } else {
        this.finalizeTurn();
      }
    }
  }

  /** The cued opening line finished — no transcript bookkeeping, never persisted, just opens the phase gate and tells the client its mic can go live. */
  private finalizeOpening(): void {
    if (this.phase !== 'opening') return; // duplicate/late turnComplete — no-op by design
    this.phase = 'idle';
    this.currentUserTranscript = '';
    this.currentAiTranscript = '';
    this.sendToClient({ type: 'openingReady' });
  }

  /** Exactly-once per turn — see this file's own header for the `phase` guard's job. */
  private finalizeTurn(): void {
    if (this.phase !== 'active') return; // duplicate/late turnComplete — no-op by design
    this.phase = 'idle';
    // TEMPORARY diagnostic — no-op unless SPEAKING_LIVE_AUDIO_DEBUG_DUMP is
    // set; runs regardless of whether the turn ends up empty/garbled/fine,
    // since a WAV of exactly what was captured is the point either way.
    void this.audioDiagnostics.finalize('turn');

    const userText = this.currentUserTranscript.trim();
    const aiText = this.currentAiTranscript.trim();
    this.currentUserTranscript = '';
    this.currentAiTranscript = '';

    if (!userText || !aiText) {
      this.logger.warn(
        `Speaking Live turn produced an empty transcript (userId=${this.userId}, attemptId=${this.attemptId}) — not persisted`,
      );
      this.sendToClient({ type: 'turnEmpty' });
      return;
    }

    this.sessionStore
      .appendTurn(this.userId, this.attemptId, userText, aiText)
      .then(() => this.sendToClient({ type: 'turnFinalized', userText, aiText }))
      .catch((error: Error) => {
        this.logger.error('Failed to persist a finalized Speaking Live turn', error);
        this.sendToClient({ type: 'turnError' });
      });
  }

  /** A transport-level Gemini failure — ends the WHOLE conversation, see this file's header. */
  private handleFatal(reason: string): void {
    if (this.ended) return;
    this.ended = true;
    const hadInFlightTurn = this.phase === 'active';
    this.phase = 'idle';
    this.currentUserTranscript = '';
    this.currentAiTranscript = '';
    this.audioDiagnostics.reset();
    this.logger.warn(`Speaking Live session ended (${reason})`);
    if (hadInFlightTurn) this.sendToClient({ type: 'turnError' });
    this.sendToClient({ type: 'sessionClosed', reason });
  }
}
