import { ConfigService } from '@nestjs/config';
import {
  GeminiPronunciationFeedbackProvider,
  MAX_FEEDBACK_CHARS,
  truncateFeedback,
} from './gemini-pronunciation-feedback.provider';
import { PronunciationFeedbackError } from './pronunciation-feedback.provider';

// Sprint 11 Phase 4C — the Gemini coaching adapter.
//
// `fetch` is stubbed throughout: this suite is about the shape of the request
// we send and how we interpret what comes back, and a real call would be paid,
// slow and non-deterministic.
//
// THE HEADLINE DIFFERENCE FROM THE TRANSCRIBER'S SUITE: there, the guarantee
// is that the reference sentence NEVER reaches the model. Here it is that the
// reference sentence DOES, and that nothing numeric comes back. Two providers,
// two opposite guarantees, which is exactly why they are two files.

const config = (values: Record<string, unknown> = {}): ConfigService =>
  ({
    get: (key: string, fallback?: unknown) =>
      key in values ? values[key] : fallback,
  }) as unknown as ConfigService;

const okResponse = (body: unknown): Response =>
  ({ ok: true, status: 200, json: () => Promise.resolve(body) }) as unknown as Response;

const answer = (text: string) => okResponse({
  candidates: [{ content: { parts: [{ text }] } }],
});

const feedbackRequest = {
  audio: Buffer.from('fake-audio'),
  mimeType: 'audio/webm;codecs=opus',
  referenceText: 'The otter wraps her baby in kelp',
  transcript: 'The otter wraps her baby',
  languageCode: 'en-US',
};

const sentBody = (fetchSpy: jest.SpyInstance) =>
  JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string) as {
    contents: { parts: { text?: string; inline_data?: { mime_type: string } }[] }[];
    generationConfig: { temperature: number };
  };

afterEach(() => {
  jest.restoreAllMocks();
});

describe('GeminiPronunciationFeedbackProvider', () => {
  it('sends the audio, the target sentence and the transcript', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(answer('Chú ý âm cuối.'));
    const provider = new GeminiPronunciationFeedbackProvider(
      config({ GEMINI_API_KEY: 'k' }),
    );

    await provider.generate(feedbackRequest);

    const parts = sentBody(fetchSpy).contents[0].parts;
    const text = parts.map((part) => part.text ?? '').join(' ');
    // Allowed HERE, and only here: coaching that does not know the target
    // sentence cannot say which word was mispronounced.
    expect(text).toContain('The otter wraps her baby in kelp');
    expect(text).toContain('The otter wraps her baby');
    expect(parts.some((part) => part.inline_data !== undefined)).toBe(true);
  });

  // The codec parameter is meaningful to MediaRecorder and noise to an
  // inference API, which rejects the whole string rather than ignoring it.
  it('strips the codec parameter from the mime type', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(answer('ok'));
    const provider = new GeminiPronunciationFeedbackProvider(
      config({ GEMINI_API_KEY: 'k' }),
    );

    await provider.generate(feedbackRequest);

    const inline = sentBody(fetchSpy).contents[0].parts.find(
      (part) => part.inline_data,
    );
    expect(inline?.inline_data?.mime_type).toBe('audio/webm');
  });

  // The app has exactly one number for an attempt and it came from the
  // alignment. The prompt is where a second one gets refused.
  it('instructs the model to give no score, rating or grade', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(answer('ok'));
    const provider = new GeminiPronunciationFeedbackProvider(
      config({ GEMINI_API_KEY: 'k' }),
    );

    await provider.generate(feedbackRequest);

    const text = sentBody(fetchSpy)
      .contents[0].parts.map((part) => part.text ?? '')
      .join(' ');
    expect(text).toMatch(/do not give a score/i);
  });

  // Not zero, unlike transcription. A transcript that varies between identical
  // requests cannot be explained to a student; coaching worded slightly
  // differently is simply coaching.
  it('runs warmer than the transcriber, but not hot', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(answer('ok'));
    const provider = new GeminiPronunciationFeedbackProvider(
      config({ GEMINI_API_KEY: 'k' }),
    );

    await provider.generate(feedbackRequest);

    const temperature = sentBody(fetchSpy).generationConfig.temperature;
    expect(temperature).toBeGreaterThan(0);
    expect(temperature).toBeLessThanOrEqual(0.5);
  });

  it('sends the API key as a header, never in the URL', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(answer('ok'));
    const provider = new GeminiPronunciationFeedbackProvider(
      config({ GEMINI_API_KEY: 'secret-key' }),
    );

    await provider.generate(feedbackRequest);

    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).not.toContain('secret-key');
    expect((init as RequestInit).headers).toMatchObject({
      'x-goog-api-key': 'secret-key',
    });
  });

  it('uses its own model variable, not the transcriber s', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(answer('ok'));
    const provider = new GeminiPronunciationFeedbackProvider(
      config({
        GEMINI_API_KEY: 'k',
        GEMINI_FEEDBACK_MODEL: 'coach-model',
        GEMINI_STT_MODEL: 'transcribe-model',
      }),
    );

    await provider.generate(feedbackRequest);

    expect(String(fetchSpy.mock.calls[0][0])).toContain('coach-model');
    expect(String(fetchSpy.mock.calls[0][0])).not.toContain('transcribe-model');
  });

  it('targets the default chain\'s first model when GEMINI_FEEDBACK_MODEL is unset', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(answer('ok'));
    const provider = new GeminiPronunciationFeedbackProvider(
      config({ GEMINI_API_KEY: 'k' }),
    );

    await provider.generate(feedbackRequest);

    expect(String(fetchSpy.mock.calls[0][0])).toContain('gemini-3.8-flash');
  });

  it('falls through to the second configured model when the first returns 503', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: false, status: 503 } as unknown as Response)
      .mockResolvedValueOnce(answer('Chú ý âm cuối.'));
    const provider = new GeminiPronunciationFeedbackProvider(
      config({ GEMINI_API_KEY: 'k', GEMINI_FEEDBACK_MODEL: 'model-a,model-b' }),
    );

    const result = await provider.generate(feedbackRequest);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('model-a');
    expect(String(fetchSpy.mock.calls[1][0])).toContain('model-b');
    expect(result.feedback).toBe('Chú ý âm cuối.');
  });

  // A missing key is not an outage. Telling an operator "the service is
  // unavailable" for a config value sends them to look at the wrong thing.
  it('reports a missing key as NOT_CONFIGURED without calling anything', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const provider = new GeminiPronunciationFeedbackProvider(config({}));

    await expect(provider.generate(feedbackRequest)).rejects.toMatchObject({
      kind: 'NOT_CONFIGURED',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reports an aborted request as TIMEOUT', async () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    jest.spyOn(global, 'fetch').mockRejectedValue(abort);
    const provider = new GeminiPronunciationFeedbackProvider(
      config({ GEMINI_API_KEY: 'k' }),
    );

    await expect(provider.generate(feedbackRequest)).rejects.toMatchObject({
      kind: 'TIMEOUT',
    });
  });

  it('reports a network failure as UNAVAILABLE', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('offline'));
    const provider = new GeminiPronunciationFeedbackProvider(
      config({ GEMINI_API_KEY: 'k' }),
    );

    await expect(provider.generate(feedbackRequest)).rejects.toBeInstanceOf(
      PronunciationFeedbackError,
    );
  });

  // 2026-09-05 production bug: the 3.x model chain spends part of
  // maxOutputTokens on invisible "thinking" before answering, and a tight
  // cap cut a real Gemini answer down to a couple of words. Feedback cut
  // off mid-sentence must fail loudly, never be shown as if complete.
  it('reports feedback cut off at the token limit as UNAVAILABLE', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      okResponse({
        candidates: [{ content: { parts: [{ text: 'Chú ý' }] }, finishReason: 'MAX_TOKENS' }],
      }),
    );
    const provider = new GeminiPronunciationFeedbackProvider(
      config({ GEMINI_API_KEY: 'k' }),
    );

    await expect(provider.generate(feedbackRequest)).rejects.toMatchObject({
      kind: 'UNAVAILABLE',
    });
  });

  it('reads a 400 as audio it cannot decode, and a 500 as an outage', async () => {
    const provider = new GeminiPronunciationFeedbackProvider(
      config({ GEMINI_API_KEY: 'k' }),
    );

    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 400,
    } as unknown as Response);
    await expect(provider.generate(feedbackRequest)).rejects.toMatchObject({
      kind: 'UNSUPPORTED_AUDIO',
    });

    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
    } as unknown as Response);
    await expect(provider.generate(feedbackRequest)).rejects.toMatchObject({
      kind: 'UNAVAILABLE',
    });
  });

  it('treats a safety block as a recording it cannot process', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      okResponse({ promptFeedback: { blockReason: 'SAFETY' } }),
    );
    const provider = new GeminiPronunciationFeedbackProvider(
      config({ GEMINI_API_KEY: 'k' }),
    );

    await expect(provider.generate(feedbackRequest)).rejects.toMatchObject({
      kind: 'UNSUPPORTED_AUDIO',
    });
  });

  // THE OPPOSITE OF THE TRANSCRIBER, deliberately. An empty transcript is a
  // legitimate result — the student was not heard — but an empty piece of
  // coaching is a blank box under a button they just pressed.
  it('treats an empty answer as a failure, not as advice', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(answer('   '));
    const provider = new GeminiPronunciationFeedbackProvider(
      config({ GEMINI_API_KEY: 'k' }),
    );

    await expect(provider.generate(feedbackRequest)).rejects.toMatchObject({
      kind: 'UNAVAILABLE',
    });
  });

  it('bounds a model that decides to write an essay', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(answer('word '.repeat(1000)));
    const provider = new GeminiPronunciationFeedbackProvider(
      config({ GEMINI_API_KEY: 'k' }),
    );

    const result = await provider.generate(feedbackRequest);

    expect(result.feedback.length).toBeLessThanOrEqual(MAX_FEEDBACK_CHARS + 1);
  });
});

describe('truncateFeedback', () => {
  it('leaves a short answer exactly as it was', () => {
    expect(truncateFeedback('  Good work.  ')).toBe('Good work.');
  });

  // A hard slice mid-word reads as a bug in the app rather than as a long
  // answer, so a late sentence break wins.
  it('cuts at a sentence end when one is near the limit', () => {
    const head = 'a'.repeat(MAX_FEEDBACK_CHARS - 20);
    const text = `${head}. ${'b'.repeat(200)}`;

    const result = truncateFeedback(text);

    expect(result.endsWith('.')).toBe(true);
    expect(result).not.toContain('b');
  });

  it('falls back to an ellipsis when the only break is far too early', () => {
    const text = `Short. ${'c'.repeat(MAX_FEEDBACK_CHARS + 200)}`;

    const result = truncateFeedback(text);

    expect(result.endsWith('…')).toBe(true);
    expect(result.length).toBeLessThanOrEqual(MAX_FEEDBACK_CHARS + 1);
  });
});
