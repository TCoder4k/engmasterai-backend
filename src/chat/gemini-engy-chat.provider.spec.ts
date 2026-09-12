import { ConfigService } from '@nestjs/config';
import { GeminiEngyChatProvider, MAX_ENGY_REPLY_CHARS, truncateEngyReply } from './gemini-engy-chat.provider';
import { EngyChatError } from './engy-chat.provider';

const config = (values: Record<string, unknown> = {}): ConfigService =>
  ({
    get: (key: string, fallback?: unknown) => (key in values ? values[key] : fallback),
  }) as unknown as ConfigService;

const encoder = new TextEncoder();

const noop = (): void => {};

/** One SSE `data:` frame for a Gemini streamGenerateContent chunk. */
const sseChunk = (payload: unknown, terminator: '\n\n' | '\r\n\r\n' = '\n\n'): string =>
  `data: ${JSON.stringify(payload)}${terminator}`;

/**
 * A fake streaming Response whose body yields exactly the given raw text
 * pieces, ONE PER `reader.read()` call (ReadableStream does not coalesce
 * separately-`enqueue()`d chunks) — this is what makes chunk-boundary tests
 * below deterministic rather than accidental.
 */
const streamResponse = (
  pieces: string[],
  options: { close?: boolean; onCancel?: () => void } = {},
): Response => {
  const { close = true, onCancel } = options;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const piece of pieces) controller.enqueue(encoder.encode(piece));
      if (close) controller.close();
    },
    cancel() {
      onCancel?.();
    },
  });
  return { ok: true, status: 200, body } as unknown as Response;
};

/** The common case: one frame, one complete answer, normal STOP finish. */
const answer = (text: string): Response =>
  streamResponse([sseChunk({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] })]);

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

    const result = await provider.reply(request, noop);

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

  it('targets streamGenerateContent with alt=sse, not the non-streaming endpoint', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(answer('ok'));
    const provider = new GeminiEngyChatProvider(config({ GEMINI_API_KEY: 'k' }));

    await provider.reply(request, noop);

    const url = String(fetchSpy.mock.calls[0][0]);
    expect(url).toContain(':streamGenerateContent');
    expect(url).toContain('alt=sse');
  });

  it('prepends a [Context] part to ONLY the latest turn when context is given, never into history or systemInstruction', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(answer('She resigned from her job yesterday.'));
    const provider = new GeminiEngyChatProvider(config({ GEMINI_API_KEY: 'k' }));

    await provider.reply(
      { ...request, context: 'The student is currently viewing the lesson "Present Perfect".' },
      noop,
    );

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

    await provider.reply({ ...request, context: null }, noop);

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

    await provider.reply(request, noop);

    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).not.toContain('secret-key');
    expect((init as RequestInit).headers).toMatchObject({ 'x-goog-api-key': 'secret-key' });
  });

  it('targets the default chain\'s first model when GEMINI_ENGY_MODEL is unset', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(answer('ok'));
    const provider = new GeminiEngyChatProvider(config({ GEMINI_API_KEY: 'k' }));

    await provider.reply(request, noop);

    expect(String(fetchSpy.mock.calls[0][0])).toContain('gemini-3.5-flash');
  });

  it('falls through to the second configured model when the first returns 503', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: false, status: 503 } as unknown as Response)
      .mockResolvedValueOnce(answer('She resigned from her job yesterday.'));
    const provider = new GeminiEngyChatProvider(
      config({ GEMINI_API_KEY: 'k', GEMINI_ENGY_MODEL: 'model-a,model-b' }),
    );

    const result = await provider.reply(request, noop);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('model-a');
    expect(String(fetchSpy.mock.calls[1][0])).toContain('model-b');
    expect(result.reply).toBe('She resigned from her job yesterday.');
  });

  it('reports a missing key as NOT_CONFIGURED without calling anything', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const provider = new GeminiEngyChatProvider(config({}));

    await expect(provider.reply(request, noop)).rejects.toMatchObject({ kind: 'NOT_CONFIGURED' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reports an aborted request as TIMEOUT', async () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    jest.spyOn(global, 'fetch').mockRejectedValue(abort);
    const provider = new GeminiEngyChatProvider(config({ GEMINI_API_KEY: 'k' }));

    await expect(provider.reply(request, noop)).rejects.toMatchObject({ kind: 'TIMEOUT' });
  });

  it('reports a network failure as UNAVAILABLE', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('offline'));
    const provider = new GeminiEngyChatProvider(config({ GEMINI_API_KEY: 'k' }));

    await expect(provider.reply(request, noop)).rejects.toBeInstanceOf(EngyChatError);
    await expect(provider.reply(request, noop)).rejects.toMatchObject({ kind: 'UNAVAILABLE' });
  });

  it('reports a non-2xx response as UNAVAILABLE', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: false, status: 500 } as unknown as Response);
    const provider = new GeminiEngyChatProvider(config({ GEMINI_API_KEY: 'k' }));

    await expect(provider.reply(request, noop)).rejects.toMatchObject({ kind: 'UNAVAILABLE' });
  });

  it('reports a reply cut off at the token limit as UNAVAILABLE, never a truncated reply', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      streamResponse([
        sseChunk({
          candidates: [{ content: { parts: [{ text: 'She resign' }] }, finishReason: 'MAX_TOKENS' }],
        }),
      ]),
    );
    const provider = new GeminiEngyChatProvider(config({ GEMINI_API_KEY: 'k' }));

    await expect(provider.reply(request, noop)).rejects.toMatchObject({ kind: 'UNAVAILABLE' });
  });

  it('reports a safety block as BLOCKED', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(streamResponse([sseChunk({ promptFeedback: { blockReason: 'SAFETY' } })]));
    const provider = new GeminiEngyChatProvider(config({ GEMINI_API_KEY: 'k' }));

    await expect(provider.reply(request, noop)).rejects.toMatchObject({ kind: 'BLOCKED' });
  });

  it('reports an empty answer as UNAVAILABLE, never a blank reply', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(answer('   '));
    const provider = new GeminiEngyChatProvider(config({ GEMINI_API_KEY: 'k' }));

    await expect(provider.reply(request, noop)).rejects.toMatchObject({ kind: 'UNAVAILABLE' });
  });

  describe('streaming delivery', () => {
    it('calls onDelta once per streamed chunk, in order, and resolves with the full accumulated text', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue(
        streamResponse([
          sseChunk({ candidates: [{ content: { parts: [{ text: 'She ' }] } }] }),
          sseChunk({ candidates: [{ content: { parts: [{ text: 'resigned ' }] } }] }),
          sseChunk({
            candidates: [{ content: { parts: [{ text: 'yesterday.' }] }, finishReason: 'STOP' }],
          }),
        ]),
      );
      const provider = new GeminiEngyChatProvider(config({ GEMINI_API_KEY: 'k' }));
      const deltas: string[] = [];

      const result = await provider.reply(request, (text) => deltas.push(text));

      expect(deltas).toEqual(['She ', 'resigned ', 'yesterday.']);
      expect(result.reply).toBe('She resigned yesterday.');
    });

    // 2026-09-12 review finding: a naive `chunk.split('\n\n')` per network
    // read silently mangles a frame that straddles two reads, or drops all
    // but the first of several frames delivered in one read. These two
    // tests exist specifically because "mock one chunk == one frame" would
    // never catch either bug.
    it('reassembles an SSE frame whose data line is split across two network reads', async () => {
      const wholeFrame = sseChunk({
        candidates: [{ content: { parts: [{ text: 'Hello there' }] }, finishReason: 'STOP' }],
      });
      const splitPoint = Math.floor(wholeFrame.length / 2);
      jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(streamResponse([wholeFrame.slice(0, splitPoint), wholeFrame.slice(splitPoint)]));
      const provider = new GeminiEngyChatProvider(config({ GEMINI_API_KEY: 'k' }));
      const deltas: string[] = [];

      const result = await provider.reply(request, (text) => deltas.push(text));

      expect(deltas).toEqual(['Hello there']);
      expect(result.reply).toBe('Hello there');
    });

    it('processes multiple SSE frames that arrive together in a single network read', async () => {
      const combined =
        sseChunk({ candidates: [{ content: { parts: [{ text: 'Hel' }] } }] }) +
        sseChunk({ candidates: [{ content: { parts: [{ text: 'lo' }] }, finishReason: 'STOP' }] });
      jest.spyOn(global, 'fetch').mockResolvedValue(streamResponse([combined]));
      const provider = new GeminiEngyChatProvider(config({ GEMINI_API_KEY: 'k' }));
      const deltas: string[] = [];

      const result = await provider.reply(request, (text) => deltas.push(text));

      expect(deltas).toEqual(['Hel', 'lo']);
      expect(result.reply).toBe('Hello');
    });

    it('accepts \\r\\n\\r\\n as the frame terminator, not just \\n\\n', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue(
        streamResponse([
          sseChunk(
            { candidates: [{ content: { parts: [{ text: 'Hi there.' }] }, finishReason: 'STOP' }] },
            '\r\n\r\n',
          ),
        ]),
      );
      const provider = new GeminiEngyChatProvider(config({ GEMINI_API_KEY: 'k' }));
      const deltas: string[] = [];

      const result = await provider.reply(request, (text) => deltas.push(text));

      expect(deltas).toEqual(['Hi there.']);
      expect(result.reply).toBe('Hi there.');
    });

    // 2026-09-12 review finding: emitting the whole oversized chunk and only
    // THEN cancelling would still leak the overflow past MAX_ENGY_REPLY_CHARS
    // to whichever onDelta subscriber already received that write.
    it('clips a single delta exactly at MAX_ENGY_REPLY_CHARS and cancels the read early', async () => {
      let cancelled = false;
      const oversized = 'x'.repeat(MAX_ENGY_REPLY_CHARS + 50);
      jest.spyOn(global, 'fetch').mockResolvedValue(
        streamResponse(
          [sseChunk({ candidates: [{ content: { parts: [{ text: oversized }] } }] })],
          // Deliberately never closed — if the implementation kept reading
          // instead of cancelling, this test would hang until Jest's own
          // timeout rather than resolve, making a regression here loud.
          { close: false, onCancel: () => { cancelled = true; } },
        ),
      );
      const provider = new GeminiEngyChatProvider(config({ GEMINI_API_KEY: 'k' }));
      const deltas: string[] = [];

      const result = await provider.reply(request, (text) => deltas.push(text));

      expect(deltas).toHaveLength(1);
      expect(deltas[0].length).toBe(MAX_ENGY_REPLY_CHARS);
      expect(cancelled).toBe(true);
      // Already at-or-under the cap, so truncateEngyReply is a pure no-op —
      // what streamed and what is stored are byte-for-byte identical here.
      expect(result.reply).toBe(deltas[0]);
      expect(result.reply.length).toBe(MAX_ENGY_REPLY_CHARS);
    });

    it('splits a delta that crosses MAX_ENGY_REPLY_CHARS mid-chunk, emitting only the part that fits', async () => {
      const already = 'a'.repeat(MAX_ENGY_REPLY_CHARS - 20);
      let cancelled = false;
      jest.spyOn(global, 'fetch').mockResolvedValue(
        streamResponse(
          [
            sseChunk({ candidates: [{ content: { parts: [{ text: already }] } }] }),
            // 70 more characters land in one chunk — only 20 fit under the cap.
            sseChunk({ candidates: [{ content: { parts: [{ text: 'b'.repeat(70) }] } }] }),
          ],
          { close: false, onCancel: () => { cancelled = true; } },
        ),
      );
      const provider = new GeminiEngyChatProvider(config({ GEMINI_API_KEY: 'k' }));
      const deltas: string[] = [];

      const result = await provider.reply(request, (text) => deltas.push(text));

      expect(deltas).toEqual([already, 'b'.repeat(20)]);
      expect(result.reply.length).toBe(MAX_ENGY_REPLY_CHARS);
      expect(cancelled).toBe(true);
    });
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
