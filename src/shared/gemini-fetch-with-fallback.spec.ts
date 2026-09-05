import { Logger } from '@nestjs/common';
import {
  fetchGeminiWithFallback,
  GeminiFetchError,
  isGeminiTimeout,
} from './gemini-fetch-with-fallback';
import { parseGeminiModelList } from './gemini-models';

const okResponse = (status = 200): Response => ({ ok: status < 300, status }) as Response;

const silentLogger = { warn: jest.fn() } as unknown as Logger;

const endpoint = (model: string) => `https://example.test/${model}`;
const buildInit = () => ({});

afterEach(() => {
  jest.restoreAllMocks();
  (silentLogger.warn as jest.Mock).mockClear();
});

describe('fetchGeminiWithFallback', () => {
  it('behaves like a plain fetch for a single-model list', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(okResponse(200));

    const result = await fetchGeminiWithFallback(
      ['model-a'],
      1000,
      endpoint,
      buildInit,
      silentLogger,
      'test-provider',
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.model).toBe('model-a');
    expect(result.response.status).toBe(200);
  });

  it('falls through to the next model on 429', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(okResponse(429))
      .mockResolvedValueOnce(okResponse(200));

    const result = await fetchGeminiWithFallback(
      ['model-a', 'model-b'],
      1000,
      endpoint,
      buildInit,
      silentLogger,
      'test-provider',
    );

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0][0]).toBe(endpoint('model-a'));
    expect(fetchSpy.mock.calls[1][0]).toBe(endpoint('model-b'));
    expect(result.model).toBe('model-b');
  });

  it('falls through to the next model on 503', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(okResponse(503))
      .mockResolvedValueOnce(okResponse(200));

    const result = await fetchGeminiWithFallback(
      ['model-a', 'model-b'],
      1000,
      endpoint,
      buildInit,
      silentLogger,
      'test-provider',
    );

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.model).toBe('model-b');
  });

  it('does not fall through on a non-retryable status, even with models remaining', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValueOnce(okResponse(400));

    const result = await fetchGeminiWithFallback(
      ['model-a', 'model-b', 'model-c'],
      1000,
      endpoint,
      buildInit,
      silentLogger,
      'test-provider',
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.model).toBe('model-a');
    expect(result.response.status).toBe(400);
  });

  it('returns the last model\'s failing response as-is once the chain is exhausted', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(okResponse(503))
      .mockResolvedValueOnce(okResponse(503));

    const result = await fetchGeminiWithFallback(
      ['model-a', 'model-b'],
      1000,
      endpoint,
      buildInit,
      silentLogger,
      'test-provider',
    );

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.model).toBe('model-b');
    expect(result.response.status).toBe(503);
  });

  it('a thrown network error on a non-last model propagates immediately as GeminiFetchError, no fallback attempted', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('offline'));

    const promise = fetchGeminiWithFallback(
      ['model-a', 'model-b'],
      1000,
      endpoint,
      buildInit,
      silentLogger,
      'test-provider',
    );

    await expect(promise).rejects.toBeInstanceOf(GeminiFetchError);
    await expect(promise).rejects.toMatchObject({ model: 'model-a' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('isGeminiTimeout recognizes an AbortError wrapped in GeminiFetchError', async () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    jest.spyOn(global, 'fetch').mockRejectedValueOnce(abort);

    const promise = fetchGeminiWithFallback(
      ['model-a'],
      1000,
      endpoint,
      buildInit,
      silentLogger,
      'test-provider',
    );

    await expect(promise).rejects.toBeInstanceOf(GeminiFetchError);
    try {
      await promise;
    } catch (caught) {
      expect(isGeminiTimeout(caught)).toBe(true);
    }
  });

  it('isGeminiTimeout is false for a plain network failure', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('offline'));

    try {
      await fetchGeminiWithFallback(
        ['model-a'],
        1000,
        endpoint,
        buildInit,
        silentLogger,
        'test-provider',
      );
      fail('expected fetchGeminiWithFallback to reject');
    } catch (caught) {
      expect(isGeminiTimeout(caught)).toBe(false);
    }
  });

  it('multi-hop: 503 -> 503 -> 200 works across a 3-model chain', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(okResponse(503))
      .mockResolvedValueOnce(okResponse(503))
      .mockResolvedValueOnce(okResponse(200));

    const result = await fetchGeminiWithFallback(
      ['model-a', 'model-b', 'model-c'],
      1000,
      endpoint,
      buildInit,
      silentLogger,
      'test-provider',
    );

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(result.model).toBe('model-c');
    expect(result.response.status).toBe(200);
  });

  it('429 -> 503 -> 400 stops the chain the instant a non-retryable status appears, never calling a configured 4th model', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(okResponse(429))
      .mockResolvedValueOnce(okResponse(503))
      .mockResolvedValueOnce(okResponse(400));

    const result = await fetchGeminiWithFallback(
      ['model-a', 'model-b', 'model-c', 'model-d'],
      1000,
      endpoint,
      buildInit,
      silentLogger,
      'test-provider',
    );

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(result.model).toBe('model-c');
    expect(result.response.status).toBe(400);
  });
});

describe('parseGeminiModelList', () => {
  it('trims and dedupes', () => {
    expect(parseGeminiModelList(' a , b ,a, b ', 'KEY')).toEqual(['a', 'b']);
  });

  it('rejects an empty/whitespace-only list, naming the config key', () => {
    expect(() => parseGeminiModelList('  , , ', 'MY_KEY')).toThrow('MY_KEY');
  });
});
