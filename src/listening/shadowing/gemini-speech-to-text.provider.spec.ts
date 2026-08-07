import { ConfigService } from '@nestjs/config';
import {
  GeminiSpeechToTextProvider,
  extractTranscript,
  normaliseMimeForProvider,
} from './gemini-speech-to-text.provider';
import { SpeechToTextError } from './speech-to-text.provider';

// Sprint 11 Phase 4B — the Gemini adapter.
//
// `fetch` is stubbed throughout: this suite is about the shape of the request
// we send and how we interpret what comes back, and a real call would be paid,
// slow and non-deterministic.

const config = (values: Record<string, unknown> = {}): ConfigService =>
  ({
    get: (key: string, fallback?: unknown) =>
      key in values ? values[key] : fallback,
  }) as unknown as ConfigService;

const okResponse = (body: unknown): Response =>
  ({ ok: true, status: 200, json: () => Promise.resolve(body) }) as unknown as Response;

const audioRequest = {
  audio: Buffer.from('fake-audio'),
  mimeType: 'audio/webm;codecs=opus',
  languageCode: 'en-US',
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe('GeminiSpeechToTextProvider', () => {
  // THE GUARANTEE THAT MATTERS. A language model given the expected sentence
  // returns the expected sentence, every student scores 100%, and the
  // transcripts look perfect while the feature measures nothing.
  it('sends the audio and the prompt, and nothing that could reveal the answer', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(okResponse({
        candidates: [{ content: { parts: [{ text: '{"transcript":"hello"}' }] } }],
      }));
    const provider = new GeminiSpeechToTextProvider(config({ GEMINI_API_KEY: 'k' }));

    await provider.transcribe(audioRequest);

    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    ) as { contents: { parts: { text?: string }[] }[] };
    const textParts = body.contents[0].parts
      .map((part) => part.text ?? '')
      .join(' ');
    // The prompt is instructions only. There is no field on the request type
    // that could carry a reference sentence, and this asserts the call site
    // did not invent one.
    expect(textParts).toContain('verbatim');
    expect(textParts).not.toMatch(/otter|reference|expected/i);
  });

  it('sends the API key as a header, never in the URL', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      okResponse({ candidates: [{ content: { parts: [{ text: 'hi' }] } }] }),
    );
    const provider = new GeminiSpeechToTextProvider(
      config({ GEMINI_API_KEY: 'secret-key' }),
    );

    await provider.transcribe(audioRequest);

    // A key in a query string ends up in access logs, proxy logs and error
    // reports — all places nobody intends to store a credential.
    expect(fetchSpy.mock.calls[0][0] as string).not.toContain('secret-key');
    const headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Record<
      string,
      string
    >;
    expect(headers['x-goog-api-key']).toBe('secret-key');
  });

  it('asks for a deterministic answer, so one recording cannot get two scores', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      okResponse({ candidates: [{ content: { parts: [{ text: 'hi' }] } }] }),
    );
    const provider = new GeminiSpeechToTextProvider(config({ GEMINI_API_KEY: 'k' }));

    await provider.transcribe(audioRequest);

    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    ) as { generationConfig: { temperature: number; responseMimeType: string } };
    expect(body.generationConfig.temperature).toBe(0);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
  });

  it('strips codec parameters the inference API will not accept', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      okResponse({ candidates: [{ content: { parts: [{ text: 'hi' }] } }] }),
    );
    const provider = new GeminiSpeechToTextProvider(config({ GEMINI_API_KEY: 'k' }));

    await provider.transcribe(audioRequest);

    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    ) as { contents: { parts: { inline_data?: { mime_type: string } }[] }[] };
    const inline = body.contents[0].parts.find((part) => part.inline_data);
    expect(inline?.inline_data?.mime_type).toBe('audio/webm');
  });

  // Distinct from an outage: nothing is broken, the deployment has no key.
  // Reporting this as "the speech service is unavailable" sends an operator to
  // look at the wrong thing.
  it('reports a missing key as NOT_CONFIGURED without calling out', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const provider = new GeminiSpeechToTextProvider(config({}));

    await expect(provider.transcribe(audioRequest)).rejects.toMatchObject({
      kind: 'NOT_CONFIGURED',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reports a 400 as bad audio and a 500 as an outage', async () => {
    const provider = new GeminiSpeechToTextProvider(config({ GEMINI_API_KEY: 'k' }));

    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: false, status: 400 } as unknown as Response);
    await expect(provider.transcribe(audioRequest)).rejects.toMatchObject({
      kind: 'UNSUPPORTED_AUDIO',
    });

    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: false, status: 500 } as unknown as Response);
    await expect(provider.transcribe(audioRequest)).rejects.toMatchObject({
      kind: 'UNAVAILABLE',
    });
  });

  it('reports an aborted request as a timeout', async () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    jest.spyOn(global, 'fetch').mockRejectedValue(abort);
    const provider = new GeminiSpeechToTextProvider(config({ GEMINI_API_KEY: 'k' }));

    await expect(provider.transcribe(audioRequest)).rejects.toMatchObject({
      kind: 'TIMEOUT',
    });
  });

  it('reports a safety block as unprocessable audio, not as an outage', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(okResponse({ promptFeedback: { blockReason: 'SAFETY' } }));
    const provider = new GeminiSpeechToTextProvider(config({ GEMINI_API_KEY: 'k' }));

    await expect(provider.transcribe(audioRequest)).rejects.toBeInstanceOf(
      SpeechToTextError,
    );
    await expect(provider.transcribe(audioRequest)).rejects.toMatchObject({
      kind: 'UNSUPPORTED_AUDIO',
    });
  });

  // Silence is a RESULT, not a failure. "You were not heard" is something a
  // student can act on; an exception would hide it behind a retry prompt.
  it('returns an empty transcript for silence rather than raising', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      okResponse({ candidates: [{ content: { parts: [{ text: '' }] } }] }),
    );
    const provider = new GeminiSpeechToTextProvider(config({ GEMINI_API_KEY: 'k' }));

    await expect(provider.transcribe(audioRequest)).resolves.toEqual({
      transcript: '',
    });
  });
});

describe('extractTranscript', () => {
  it('reads the schema-shaped answer', () => {
    expect(extractTranscript('{"transcript":"the otter swims"}')).toBe(
      'the otter swims',
    );
  });

  // Models ignore schemas. A transcript that arrived in the wrong wrapper is
  // still the student's words, and refusing it would turn a formatting quirk
  // into a lost attempt.
  it('falls back to the raw text when the model answered in prose', () => {
    expect(extractTranscript('  the otter swims  ')).toBe('the otter swims');
  });

  it('falls back when the JSON is the wrong shape', () => {
    expect(extractTranscript('{"text":"the otter swims"}')).toBe(
      '{"text":"the otter swims"}',
    );
  });
});

describe('normaliseMimeForProvider', () => {
  it.each([
    ['audio/webm;codecs=opus', 'audio/webm'],
    ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4'],
    ['AUDIO/OGG', 'audio/ogg'],
    ['audio/wav', 'audio/wav'],
  ])('reduces %s to %s', (input, expected) => {
    expect(normaliseMimeForProvider(input)).toBe(expected);
  });
});
