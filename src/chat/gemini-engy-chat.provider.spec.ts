import { ConfigService } from '@nestjs/config';
import { GeminiEngyChatProvider, truncateEngyReply } from './gemini-engy-chat.provider';
import { EngyChatError } from './engy-chat.provider';

const config = (values: Record<string, unknown> = {}): ConfigService =>
  ({
    get: (key: string, fallback?: unknown) => (key in values ? values[key] : fallback),
  }) as unknown as ConfigService;

const okResponse = (body: unknown): Response =>
  ({ ok: true, status: 200, json: () => Promise.resolve(body) }) as unknown as Response;

const answer = (text: string) =>
  okResponse({ candidates: [{ content: { parts: [{ text }] } }] });

const request = {
  history: [
    { role: 'user' as const, text: 'What does "resign" mean?' },
    { role: 'assistant' as const, text: 'It means to quit a job.' },
  ],
  message: 'Can you give an example sentence?',
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe('GeminiEngyChatProvider', () => {
  it('replies successfully and includes a systemInstruction plus the full history + new message', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(answer('She resigned from her job yesterday.'));
    const provider = new GeminiEngyChatProvider(config({ GEMINI_API_KEY: 'k' }));

    const result = await provider.reply(request);

    expect(result.reply).toBe('She resigned from her job yesterday.');
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string) as {
      systemInstruction: { parts: { text: string }[] };
      contents: { role: string; parts: { text: string }[] }[];
    };
    expect(body.systemInstruction.parts[0].text).toContain('Engy');
    expect(body.contents).toEqual([
      { role: 'user', parts: [{ text: 'What does "resign" mean?' }] },
      { role: 'model', parts: [{ text: 'It means to quit a job.' }] },
      { role: 'user', parts: [{ text: 'Can you give an example sentence?' }] },
    ]);
  });

  it('prepends a [Context] part to ONLY the latest turn when context is given, never into history or systemInstruction', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(answer('She resigned from her job yesterday.'));
    const provider = new GeminiEngyChatProvider(config({ GEMINI_API_KEY: 'k' }));

    await provider.reply({
      ...request,
      context: 'The student is currently viewing the lesson "Present Perfect".',
    });

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string) as {
      systemInstruction: { parts: { text: string }[] };
      contents: { role: string; parts: { text: string }[] }[];
    };
    expect(body.contents).toEqual([
      { role: 'user', parts: [{ text: 'What does "resign" mean?' }] },
      { role: 'model', parts: [{ text: 'It means to quit a job.' }] },
      {
        role: 'user',
        parts: [
          {
            text: '[Context]\nThe student is currently viewing the lesson "Present Perfect".',
          },
          { text: 'Can you give an example sentence?' },
        ],
      },
    ]);
    expect(body.systemInstruction.parts[0].text).not.toContain('Present Perfect');
  });

  it('omits the [Context] part entirely when context is null/absent', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(answer('ok'));
    const provider = new GeminiEngyChatProvider(config({ GEMINI_API_KEY: 'k' }));

    await provider.reply({ ...request, context: null });

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string) as {
      contents: { role: string; parts: { text: string }[] }[];
    };
    expect(body.contents[body.contents.length - 1]).toEqual({
      role: 'user',
      parts: [{ text: 'Can you give an example sentence?' }],
    });
  });

  it('sends the API key as a header, never in the URL', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(answer('ok'));
    const provider = new GeminiEngyChatProvider(config({ GEMINI_API_KEY: 'secret-key' }));

    await provider.reply(request);

    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).not.toContain('secret-key');
    expect((init as RequestInit).headers).toMatchObject({ 'x-goog-api-key': 'secret-key' });
  });

  it('uses gemini-3.5-flash-lite by default', () => {
    const provider = new GeminiEngyChatProvider(config());
    expect(provider.model).toBe('gemini-3.5-flash-lite');
  });

  it('honours GEMINI_ENGY_MODEL when set', () => {
    const provider = new GeminiEngyChatProvider(config({ GEMINI_ENGY_MODEL: 'custom-model' }));
    expect(provider.model).toBe('custom-model');
  });

  it('reports a missing key as NOT_CONFIGURED without calling anything', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const provider = new GeminiEngyChatProvider(config({}));

    await expect(provider.reply(request)).rejects.toMatchObject({ kind: 'NOT_CONFIGURED' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reports an aborted request as TIMEOUT', async () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    jest.spyOn(global, 'fetch').mockRejectedValue(abort);
    const provider = new GeminiEngyChatProvider(config({ GEMINI_API_KEY: 'k' }));

    await expect(provider.reply(request)).rejects.toMatchObject({ kind: 'TIMEOUT' });
  });

  it('reports a network failure as UNAVAILABLE', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('offline'));
    const provider = new GeminiEngyChatProvider(config({ GEMINI_API_KEY: 'k' }));

    await expect(provider.reply(request)).rejects.toBeInstanceOf(EngyChatError);
    await expect(provider.reply(request)).rejects.toMatchObject({ kind: 'UNAVAILABLE' });
  });

  it('reports a non-2xx response as UNAVAILABLE', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: false, status: 500 } as unknown as Response);
    const provider = new GeminiEngyChatProvider(config({ GEMINI_API_KEY: 'k' }));

    await expect(provider.reply(request)).rejects.toMatchObject({ kind: 'UNAVAILABLE' });
  });

  it('reports a safety block as BLOCKED', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(okResponse({ promptFeedback: { blockReason: 'SAFETY' } }));
    const provider = new GeminiEngyChatProvider(config({ GEMINI_API_KEY: 'k' }));

    await expect(provider.reply(request)).rejects.toMatchObject({ kind: 'BLOCKED' });
  });

  it('reports an empty answer as UNAVAILABLE, never a blank reply', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(answer('   '));
    const provider = new GeminiEngyChatProvider(config({ GEMINI_API_KEY: 'k' }));

    await expect(provider.reply(request)).rejects.toMatchObject({ kind: 'UNAVAILABLE' });
  });
});

describe('truncateEngyReply', () => {
  it('leaves a short reply untouched', () => {
    expect(truncateEngyReply('Short answer.')).toBe('Short answer.');
  });

  it('cuts a long reply at the last sentence boundary within the tail third', () => {
    const long = `${'a'.repeat(900)}. ${'b'.repeat(200)}`;
    const result = truncateEngyReply(long);
    expect(result.length).toBeLessThanOrEqual(1000);
    expect(result.endsWith('.')).toBe(true);
  });

  it('falls back to a hard cut with an ellipsis when there is no sentence boundary', () => {
    const long = 'x'.repeat(1200);
    const result = truncateEngyReply(long);
    expect(result.endsWith('…')).toBe(true);
    expect(result.length).toBeLessThanOrEqual(1001);
  });
});
