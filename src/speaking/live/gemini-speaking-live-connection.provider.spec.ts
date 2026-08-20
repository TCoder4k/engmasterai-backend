import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import { GeminiSpeakingLiveConnectionProvider } from './gemini-speaking-live-connection.provider';
import { SpeakingLiveConnectOptions, SpeakingLiveError } from './speaking-live-connection.provider';

// GeminiSpeakingLiveConnectionProvider is the ONE deliberate exception in
// this codebase that talks to @google/genai's SDK directly rather than bare
// fetch (see that file's own header) — no existing test mocks this SDK, so
// this spec establishes the pattern: preserve everything else the module
// exports (Modality, AudioTranscriptionConfig, etc.) via jest.requireActual,
// replace only the GoogleGenAI constructor.
//
// THE POINT OF THIS FILE, per the Speaking Live transcript-accuracy
// investigation (docs/sprints/sprint-13-speaking-partner.md §17): pin that
// input and output language hints are genuinely TWO INDEPENDENT config
// values, read from two separate env vars, never a shared array reference
// — the exact conflation a review caught in an earlier draft of this fix.

jest.mock('@google/genai', () => {
  const actual = jest.requireActual('@google/genai');
  return { ...actual, GoogleGenAI: jest.fn() };
});

const mockedGoogleGenAI = GoogleGenAI as unknown as jest.Mock;

interface FakeSession {
  sendRealtimeInput: jest.Mock;
  sendClientContent: jest.Mock;
  close: jest.Mock;
}

const buildFakeSession = (): FakeSession => ({
  sendRealtimeInput: jest.fn(),
  sendClientContent: jest.fn(),
  close: jest.fn(),
});

const buildConfig = (overrides: Record<string, string> = {}): ConfigService => {
  const values: Record<string, string> = { GEMINI_API_KEY: 'test-key', ...overrides };
  return {
    get: jest.fn((key: string, defaultValue?: unknown) =>
      key in values ? values[key] : defaultValue,
    ),
  } as unknown as ConfigService;
};

const CONNECT_OPTIONS: SpeakingLiveConnectOptions = {
  systemInstruction: 'be a friendly barista',
  callbacks: { onmessage: jest.fn(), onerror: jest.fn(), onclose: jest.fn() },
};

describe('GeminiSpeakingLiveConnectionProvider', () => {
  let connectMock: jest.Mock;
  let fakeSession: FakeSession;

  beforeEach(() => {
    fakeSession = buildFakeSession();
    connectMock = jest.fn().mockResolvedValue(fakeSession);
    mockedGoogleGenAI.mockImplementation(() => ({ live: { connect: connectMock } }));
  });

  it('throws NOT_CONFIGURED when GEMINI_API_KEY is missing, without ever calling the SDK', async () => {
    const provider = new GeminiSpeakingLiveConnectionProvider(buildConfig({ GEMINI_API_KEY: '' }));

    await expect(provider.connect(CONNECT_OPTIONS)).rejects.toMatchObject({
      constructor: SpeakingLiveError,
      kind: 'NOT_CONFIGURED',
    });
    expect(connectMock).not.toHaveBeenCalled();
  });

  it('wraps a failed ai.live.connect() as CONNECT_FAILED', async () => {
    connectMock.mockRejectedValue(new Error('network down'));
    const provider = new GeminiSpeakingLiveConnectionProvider(buildConfig());

    await expect(provider.connect(CONNECT_OPTIONS)).rejects.toMatchObject({
      constructor: SpeakingLiveError,
      kind: 'CONNECT_FAILED',
    });
  });

  it('defaults BOTH input and output language hints to en-US,vi-VN when no env override is set', async () => {
    const provider = new GeminiSpeakingLiveConnectionProvider(buildConfig());

    await provider.connect(CONNECT_OPTIONS);

    const config = connectMock.mock.calls[0][0].config;
    expect(config.inputAudioTranscription).toEqual({ languageCodes: ['en-US', 'vi-VN'] });
    expect(config.outputAudioTranscription).toEqual({ languageCodes: ['en-US', 'vi-VN'] });
  });

  it('input and output language hints are genuinely independent — overriding one never touches the other', async () => {
    const provider = new GeminiSpeakingLiveConnectionProvider(
      buildConfig({
        GEMINI_LIVE_INPUT_LANGUAGE_CODES: 'en-US',
        GEMINI_LIVE_OUTPUT_LANGUAGE_CODES: 'vi-VN',
      }),
    );

    await provider.connect(CONNECT_OPTIONS);

    const config = connectMock.mock.calls[0][0].config;
    expect(config.inputAudioTranscription).toEqual({ languageCodes: ['en-US'] });
    expect(config.outputAudioTranscription).toEqual({ languageCodes: ['vi-VN'] });
  });

  it('an empty-string override omits languageCodes entirely — Gemini automatic language detection, the pre-fix behaviour (the "A" leg of the A/B/C comparison)', async () => {
    const provider = new GeminiSpeakingLiveConnectionProvider(
      buildConfig({ GEMINI_LIVE_INPUT_LANGUAGE_CODES: '', GEMINI_LIVE_OUTPUT_LANGUAGE_CODES: '' }),
    );

    await provider.connect(CONNECT_OPTIONS);

    const config = connectMock.mock.calls[0][0].config;
    expect(config.inputAudioTranscription).toEqual({});
    expect(config.outputAudioTranscription).toEqual({});
  });

  it('trims whitespace and drops empty entries from a comma-separated override', async () => {
    const provider = new GeminiSpeakingLiveConnectionProvider(
      buildConfig({ GEMINI_LIVE_INPUT_LANGUAGE_CODES: ' en-US ,, vi-VN ,' }),
    );

    await provider.connect(CONNECT_OPTIONS);

    const config = connectMock.mock.calls[0][0].config;
    expect(config.inputAudioTranscription).toEqual({ languageCodes: ['en-US', 'vi-VN'] });
  });

  it('the returned handle wires sendRealtimeInput/close straight through to the SDK session', async () => {
    const provider = new GeminiSpeakingLiveConnectionProvider(buildConfig());

    const handle = await provider.connect(CONNECT_OPTIONS);
    handle.sendRealtimeInput({ activityStart: {} });
    handle.close();

    expect(fakeSession.sendRealtimeInput).toHaveBeenCalledWith({ activityStart: {} });
    expect(fakeSession.close).toHaveBeenCalledTimes(1);
  });

  it('sendClientTurn sends a user-role text turn via sendClientContent, not sendRealtimeInput', async () => {
    const provider = new GeminiSpeakingLiveConnectionProvider(buildConfig());

    const handle = await provider.connect(CONNECT_OPTIONS);
    handle.sendClientTurn('Say the opening line now.');

    expect(fakeSession.sendClientContent).toHaveBeenCalledWith({
      turns: [{ role: 'user', parts: [{ text: 'Say the opening line now.' }] }],
      turnComplete: true,
    });
    expect(fakeSession.sendRealtimeInput).not.toHaveBeenCalled();
  });

  it('model and voice still honour their own env vars, unaffected by the language-hint change', async () => {
    const provider = new GeminiSpeakingLiveConnectionProvider(
      buildConfig({ GEMINI_LIVE_MODEL: 'gemini-custom-live', GEMINI_LIVE_VOICE: 'Puck' }),
    );

    await provider.connect(CONNECT_OPTIONS);

    const call = connectMock.mock.calls[0][0];
    expect(call.model).toBe('gemini-custom-live');
    expect(call.config.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('Puck');
  });
});
