import { ConfigService } from '@nestjs/config';
import {
  GeminiViTranslationProvider,
  extractTranslation,
} from './gemini-vi-translation.provider';
import { ViTranslationError } from './vi-translation.provider';

const config = (values: Record<string, unknown> = {}): ConfigService =>
  ({
    get: (key: string, fallback?: unknown) =>
      key in values ? values[key] : fallback,
  }) as unknown as ConfigService;

const okResponse = (body: unknown): Response =>
  ({ ok: true, status: 200, json: () => Promise.resolve(body) }) as unknown as Response;

const answer = (json: object) =>
  okResponse({ candidates: [{ content: { parts: [{ text: JSON.stringify(json) }] } }] });

const request = { word: 'hello', definitionEn: 'Used as a greeting.' };

afterEach(() => {
  jest.restoreAllMocks();
});

describe('GeminiViTranslationProvider', () => {
  it('sends the word and English definition, asks for structured JSON at temperature 0', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(answer({ translation: 'Xin chào' }));
    const provider = new GeminiViTranslationProvider(config({ GEMINI_API_KEY: 'k' }));

    const result = await provider.translate(request);

    expect(result.translation).toBe('Xin chào');
    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    ) as { generationConfig: { temperature: number; responseSchema: unknown } };
    expect(body.generationConfig.temperature).toBe(0);
    expect(body.generationConfig.responseSchema).toBeDefined();
  });

  it('sends the API key as a header, never in the URL', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(answer({ translation: 'ok' }));
    const provider = new GeminiViTranslationProvider(
      config({ GEMINI_API_KEY: 'secret-key' }),
    );

    await provider.translate(request);

    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).not.toContain('secret-key');
    expect((init as RequestInit).headers).toMatchObject({ 'x-goog-api-key': 'secret-key' });
  });

  it('uses gemini-3.6-flash by default, distinct from the other providers', () => {
    const provider = new GeminiViTranslationProvider(config());
    expect(provider.model).toBe('gemini-3.6-flash');
  });

  it('honours GEMINI_DICTIONARY_TRANSLATION_MODEL when set', () => {
    const provider = new GeminiViTranslationProvider(
      config({ GEMINI_DICTIONARY_TRANSLATION_MODEL: 'custom-model' }),
    );
    expect(provider.model).toBe('custom-model');
  });

  it('reports a missing key as NOT_CONFIGURED without calling anything', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const provider = new GeminiViTranslationProvider(config({}));

    await expect(provider.translate(request)).rejects.toMatchObject({
      kind: 'NOT_CONFIGURED',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reports an aborted request as TIMEOUT', async () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    jest.spyOn(global, 'fetch').mockRejectedValue(abort);
    const provider = new GeminiViTranslationProvider(config({ GEMINI_API_KEY: 'k' }));

    await expect(provider.translate(request)).rejects.toMatchObject({ kind: 'TIMEOUT' });
  });

  it('reports a network failure as UNAVAILABLE', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('offline'));
    const provider = new GeminiViTranslationProvider(config({ GEMINI_API_KEY: 'k' }));

    await expect(provider.translate(request)).rejects.toBeInstanceOf(ViTranslationError);
  });

  it('treats a safety block as UNAVAILABLE', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(okResponse({ promptFeedback: { blockReason: 'SAFETY' } }));
    const provider = new GeminiViTranslationProvider(config({ GEMINI_API_KEY: 'k' }));

    await expect(provider.translate(request)).rejects.toMatchObject({ kind: 'UNAVAILABLE' });
  });
});

describe('extractTranslation', () => {
  it('parses a well-formed structured answer', () => {
    expect(extractTranslation('{"translation":"Xin chào"}')).toEqual({
      translation: 'Xin chào',
    });
  });

  it('rejects unparseable output', () => {
    expect(() => extractTranslation('not json')).toThrow(ViTranslationError);
  });

  it('rejects a missing or empty translation field', () => {
    expect(() => extractTranslation('{"translation":""}')).toThrow(ViTranslationError);
    expect(() => extractTranslation('{}')).toThrow(ViTranslationError);
  });
});
