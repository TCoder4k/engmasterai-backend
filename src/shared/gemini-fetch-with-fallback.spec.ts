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

  // Regression test for the confirmed 2026-09-09 production incident:
  // gemini-3.8-flash (front of the default chain) hung with no response at
  // all while gemini-3.5-flash (back of the chain) answered normally —
  // measured directly against the real API. Before this fix, a timeout on
  // a non-last model propagated immediately instead of trying the next one.
  it('falls through to the next model on a TIMEOUT (AbortError), not just 429/503', async () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockRejectedValueOnce(abort)
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
    expect(result.response.status).toBe(200);
    expect(silentLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Gemini fallback (timeout) from=model-a to=model-b'),
    );
  });

  it('a TIMEOUT on the LAST model still propagates as GeminiFetchError — nothing left to fall through to', async () => {
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
    await expect(promise).rejects.toMatchObject({ model: 'model-a' });
  });

  it('multi-hop: TIMEOUT -> 503 -> 200 — a hang and a capacity error both fall through in the same chain', async () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockRejectedValueOnce(abort)
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

describe('fetchGeminiWithFallback — externalSignal (2026-09-12, Engy Chat disconnect handling)', () => {
  it('stops immediately, never calling fetch at all, when externalSignal is already aborted', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const controller = new AbortController();
    controller.abort();

    const promise = fetchGeminiWithFallback(
      ['model-a', 'model-b'],
      1000,
      endpoint,
      buildInit,
      silentLogger,
      'test-provider',
      controller.signal,
    );

    await expect(promise).rejects.toBeInstanceOf(GeminiFetchError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // The whole point of distinguishing this from a per-attempt timeout: once
  // the CALLER has given up (client disconnected), trying another paid
  // model for a reply nobody will ever see is pure waste.
  it('an externalSignal abort mid-attempt stops the WHOLE chain, unlike a per-attempt timeout which falls through', async () => {
    const controller = new AbortController();
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementationOnce(async () => {
      controller.abort(); // the client disconnects WHILE this attempt is in flight
      throw abort;
    });

    const promise = fetchGeminiWithFallback(
      ['model-a', 'model-b'],
      1000,
      endpoint,
      buildInit,
      silentLogger,
      'test-provider',
      controller.signal,
    );

    await expect(promise).rejects.toBeInstanceOf(GeminiFetchError);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // never tried model-b
  });

  it('passing a never-aborted externalSignal leaves ordinary timeout-fallback behavior unchanged', async () => {
    const controller = new AbortController(); // never aborted for this test
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockRejectedValueOnce(abort)
      .mockResolvedValueOnce(okResponse(200));

    const result = await fetchGeminiWithFallback(
      ['model-a', 'model-b'],
      1000,
      endpoint,
      buildInit,
      silentLogger,
      'test-provider',
      controller.signal,
    );

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.model).toBe('model-b');
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
