import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AudioTranscriptionConfig, GoogleGenAI, Modality } from '@google/genai';
import {
  SpeakingLiveConnectOptions,
  SpeakingLiveConnectionHandle,
  SpeakingLiveConnectionProvider,
  SpeakingLiveError,
  SpeakingLiveServerMessage,
} from './speaking-live-connection.provider';

// Speaking Partner Live — the real Gemini Live connection, via @google/genai.
//
// THE ONE DELIBERATE EXCEPTION TO "PLAIN FETCH, NO SDK". Every other Gemini
// provider in this codebase talks to the REST `generateContent` endpoint
// with a bare `fetch` call — that convention exists because a request/
// response call needs nothing more. The Live API is a stateful, bidirectional
// WebSocket protocol; `fetch` cannot do that, and hand-rolling the wire
// format (auth handshake, message framing, reconnection semantics) would
// just be a worse, unmaintained version of what `@google/genai`'s
// `ai.live.connect()` already does. See docs/CLAUDE.md's Speaking Live
// section for this call.
//
// MANUAL TURN CONTROL, NOT AUTOMATIC VAD. `realtimeInputConfig
// .automaticActivityDetection.disabled = true` is what makes tap-to-talk
// possible at all over this API — see speaking-live-session.ts's own header
// for the activityStart/activityEnd protocol this enables.
//
// TRANSCRIPTS REPLACE THE OLD STT PROVIDER ENTIRELY. inputAudioTranscription
// / outputAudioTranscription turn on text transcripts of both sides of the
// call — confirmed empirically (a throwaway spike script, logged against a
// real session) that `.text` arrives as an incremental DELTA per message,
// not a repeated full string — see speaking-live-session.ts's `combine()`.

const DEFAULT_MODEL = 'gemini-3.1-flash-live-preview';
const DEFAULT_VOICE = 'Erinome';
// BCP-47 hints for AudioTranscriptionConfig.languageCodes — see
// env.validation.ts's own comment for why input and output are deliberately
// TWO independent vars rather than one shared list (different reasoning:
// the student's own speech vs. Gemini's spoken reply), even though today's
// defaults happen to match. NOT presented as a confirmed fix for any
// transcription-accuracy report — see the Speaking Live sprint doc's §17
// for the controlled A/B/C comparison this exists to support, and
// SpeakingLiveAudioDiagnostics for the actual evidence-gathering tool.
const DEFAULT_INPUT_LANGUAGE_CODES = 'en-US,vi-VN';
const DEFAULT_OUTPUT_LANGUAGE_CODES = 'en-US,vi-VN';

const parseLanguageCodes = (raw: string): string[] =>
  raw
    .split(',')
    .map((code) => code.trim())
    .filter(Boolean);

@Injectable()
export class GeminiSpeakingLiveConnectionProvider implements SpeakingLiveConnectionProvider {
  private readonly logger = new Logger(GeminiSpeakingLiveConnectionProvider.name);

  constructor(private readonly config: ConfigService) {}

  get model(): string {
    return this.config.get<string>('GEMINI_LIVE_MODEL', DEFAULT_MODEL);
  }

  get voiceName(): string {
    return this.config.get<string>('GEMINI_LIVE_VOICE', DEFAULT_VOICE);
  }

  /** Empty ("") means no hint — Gemini's own automatic language detection, the original behaviour. */
  get inputLanguageCodes(): string[] {
    return parseLanguageCodes(
      this.config.get<string>('GEMINI_LIVE_INPUT_LANGUAGE_CODES', DEFAULT_INPUT_LANGUAGE_CODES),
    );
  }

  get outputLanguageCodes(): string[] {
    return parseLanguageCodes(
      this.config.get<string>('GEMINI_LIVE_OUTPUT_LANGUAGE_CODES', DEFAULT_OUTPUT_LANGUAGE_CODES),
    );
  }

  private buildTranscriptionConfig(languageCodes: string[]): AudioTranscriptionConfig {
    return languageCodes.length > 0 ? { languageCodes } : {};
  }

  async connect(options: SpeakingLiveConnectOptions): Promise<SpeakingLiveConnectionHandle> {
    const apiKey = this.config.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      throw new SpeakingLiveError(
        'NOT_CONFIGURED',
        'GEMINI_API_KEY is not set; Speaking Live is unavailable',
      );
    }

    const ai = new GoogleGenAI({ apiKey });
    const model = this.model;

    let session: Awaited<ReturnType<typeof ai.live.connect>>;
    try {
      session = await ai.live.connect({
        model,
        callbacks: {
          onopen: () => {},
          onmessage: (message) =>
            options.callbacks.onmessage(message as unknown as SpeakingLiveServerMessage),
          // Conversation content is NEVER logged, here or anywhere — only
          // the shape of the failure is, same discipline as every other
          // Gemini provider in this module.
          onerror: (event) => {
            this.logger.warn(`Speaking Live connection error (model=${model})`);
            options.callbacks.onerror(
              event instanceof Error ? event : new Error('Speaking Live connection error'),
            );
          },
          onclose: (event) => {
            this.logger.log(`Speaking Live connection closed (model=${model}, reason=${event?.reason ?? 'n/a'})`);
            options.callbacks.onclose();
          },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: this.voiceName } } },
          systemInstruction: options.systemInstruction,
          inputAudioTranscription: this.buildTranscriptionConfig(this.inputLanguageCodes),
          outputAudioTranscription: this.buildTranscriptionConfig(this.outputLanguageCodes),
          // Client sends explicit activityStart/audio/activityEnd instead of
          // relying on server-side voice-activity-detection — this is what
          // preserves the existing tap-to-talk gesture over a streaming
          // connection instead of an "always listening, AI can interrupt
          // you" phone call.
          realtimeInputConfig: { automaticActivityDetection: { disabled: true } },
        },
      });
    } catch (caught) {
      this.logger.warn(`Failed to open a Speaking Live connection (model=${model})`, caught as Error);
      throw new SpeakingLiveError('CONNECT_FAILED', 'Could not start Speaking Live');
    }

    return {
      sendRealtimeInput: (input) => session.sendRealtimeInput(input),
      sendClientTurn: (text) =>
        session.sendClientContent({ turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true }),
      close: () => session.close(),
    };
  }
}
