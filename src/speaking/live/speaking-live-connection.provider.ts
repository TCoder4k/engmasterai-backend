// Speaking Partner Live — the seam between SpeakingLiveSession (the
// stateful accumulator/finalize logic, a plain class — see its own header
// for why it's NOT a NestJS singleton) and the real Gemini Live WebSocket.
// Same "own token, own interface, real impl behind it" discipline as every
// other external-call provider in this module — the payoff here is that
// speaking-live-session.spec.ts tests the accumulator/finalize state
// machine against a FAKE connection with no real network/Gemini call, the
// same way speaking-attempt.service.spec.ts already fakes
// SPEAKING_AI_PROVIDER instead of hitting Gemini for real.

export const SPEAKING_LIVE_CONNECTION_PROVIDER = 'SPEAKING_LIVE_CONNECTION_PROVIDER';

export type SpeakingLiveFailureKind = 'NOT_CONFIGURED' | 'CONNECT_FAILED';

export class SpeakingLiveError extends Error {
  constructor(
    readonly kind: SpeakingLiveFailureKind,
    message: string,
  ) {
    super(message);
    this.name = 'SpeakingLiveError';
  }
}

/** Mirrors the Live API's BidiGenerateContentServerMessage shape — only the fields this feature reads. */
export interface SpeakingLiveServerMessage {
  setupComplete?: boolean;
  serverContent?: {
    inputTranscription?: { text: string };
    outputTranscription?: { text: string };
    modelTurn?: { parts?: { inlineData?: { data: string; mimeType?: string } }[] };
    turnComplete?: boolean;
    interrupted?: boolean;
  };
  goAway?: { timeLeft?: string };
}

/** Mirrors the Live API's BidiGenerateContentRealtimeInput shape. */
export interface SpeakingLiveRealtimeInput {
  activityStart?: Record<string, never>;
  activityEnd?: Record<string, never>;
  audio?: { data: string; mimeType: string };
}

export interface SpeakingLiveConnectionHandle {
  sendRealtimeInput(input: SpeakingLiveRealtimeInput): void;
  /** A text client turn via sendClientContent (not audio) — used only to cue the opening line. See speaking-live-instruction.ts's buildSpeakingLiveOpeningCue. */
  sendClientTurn(text: string): void;
  close(): void;
}

export interface SpeakingLiveConnectCallbacks {
  onmessage(message: SpeakingLiveServerMessage): void;
  /** Fatal — see speaking-live-session.ts's own header on why an errored
   * connection ends the whole conversation in this MVP, not just one turn. */
  onerror(error: Error): void;
  onclose(): void;
}

export interface SpeakingLiveConnectOptions {
  systemInstruction: string;
  callbacks: SpeakingLiveConnectCallbacks;
}

export interface SpeakingLiveConnectionProvider {
  connect(options: SpeakingLiveConnectOptions): Promise<SpeakingLiveConnectionHandle>;
}
