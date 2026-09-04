import { ConfigService } from '@nestjs/config';
import { GeminiSpeakingTranslateProvider } from './gemini-speaking-translate.provider';
import { SpeakingTranslateError } from './speaking-translate.provider';

const config = (values: Record<string, unknown> = {}): ConfigService =>
  ({
    get: (key: string, fallback?: unknown) => (key in values ? values[key] : fallback),
  }) as unknown as ConfigService;

const okResponse = (body: unknown): Response =>
  ({ ok: true, status: 200, json: () => Promise.resolve(body) }) as unknown as Response;

const answer = (text: string) => okResponse({ candidates: [{ content: { parts: [{ text }] } }] });

const request = { text: 'What would you like to order today?' };

afterEach(() => {
  jest.restoreAllMocks();
});

describe('GeminiSpeakingTranslateProvider', () => {
  it('translates successfully, sending the source text as the single user turn', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(answer('Bạn muốn gọi món gì hôm nay?'));
    const provider = new GeminiSpeakingTranslateProvider(config({ GEMINI_API_KEY: 'k' }));

    const result = await provider.translate(request);

    expect(result.textVi).toBe('Bạn muốn gọi món gì hôm nay?');
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string) as {
      contents: { role: string; parts: { text: string }[] }[];
    };
    expect(body.contents).toEqual([
      { role: 'user', parts: [{ text: 'What would you like to order today?' }] },
    ]);
  });

  it('uses a zero temperature (one correct-enough answer, not conversational prose)', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(answer('ok'));
    const provider = new GeminiSpeakingTranslateProvider(config({ GEMINI_API_KEY: 'k' }));

    await provider.translate(request);

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string) as {
      generationConfig: { temperature: number };
    };
    expect(body.generationConfig.temperature).toBe(0);
  });

  it('sends the API key as a header, never in the URL', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(answer('ok'));
    const provider = new GeminiSpeakingTranslateProvider(config({ GEMINI_API_KEY: 'secret-key' }));

    await provider.translate(request);

    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).not.toContain('secret-key');
    expect((init as RequestInit).headers).toMatchObject({ 'x-goog-api-key': 'secret-key' });
  });

  it('uses gemini-3.6-flash by default and honours GEMINI_SPEAKING_TRANSLATE_MODEL when set', () => {
    expect(new GeminiSpeakingTranslateProvider(config()).model).toBe('gemini-3.6-flash');
    expect(
      new GeminiSpeakingTranslateProvider(
        config({ GEMINI_SPEAKING_TRANSLATE_MODEL: 'custom-model' }),
      ).model,
    ).toBe('custom-model');
  });

  it('reports a missing key as NOT_CONFIGURED without calling anything', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const provider = new GeminiSpeakingTranslateProvider(config({}));

    await expect(provider.translate(request)).rejects.toMatchObject({ kind: 'NOT_CONFIGURED' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reports an aborted request as TIMEOUT', async () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    jest.spyOn(global, 'fetch').mockRejectedValue(abort);
    const provider = new GeminiSpeakingTranslateProvider(config({ GEMINI_API_KEY: 'k' }));

    await expect(provider.translate(request)).rejects.toMatchObject({ kind: 'TIMEOUT' });
  });

  it('reports a network failure as UNAVAILABLE', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('offline'));
    const provider = new GeminiSpeakingTranslateProvider(config({ GEMINI_API_KEY: 'k' }));

    await expect(provider.translate(request)).rejects.toBeInstanceOf(SpeakingTranslateError);
    await expect(provider.translate(request)).rejects.toMatchObject({ kind: 'UNAVAILABLE' });
  });

  it('reports a non-2xx response as UNAVAILABLE', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 500 } as unknown as Response);
    const provider = new GeminiSpeakingTranslateProvider(config({ GEMINI_API_KEY: 'k' }));

    await expect(provider.translate(request)).rejects.toMatchObject({ kind: 'UNAVAILABLE' });
  });

  it('reports a safety block as BLOCKED', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(okResponse({ promptFeedback: { blockReason: 'SAFETY' } }));
    const provider = new GeminiSpeakingTranslateProvider(config({ GEMINI_API_KEY: 'k' }));

    await expect(provider.translate(request)).rejects.toMatchObject({ kind: 'BLOCKED' });
  });

  it('reports an empty answer as UNAVAILABLE, never a blank translation', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(answer('   '));
    const provider = new GeminiSpeakingTranslateProvider(config({ GEMINI_API_KEY: 'k' }));

    await expect(provider.translate(request)).rejects.toMatchObject({ kind: 'UNAVAILABLE' });
  });
});
