import { ConfigService } from '@nestjs/config';
import {
  GeminiRoadmapPlannerProvider,
  MAX_OVERALL_REASON_CHARS,
  MAX_REASON_CHARS,
  extractPlan,
  truncateOverallReason,
  truncateReason,
} from './gemini-roadmap-planner.provider';
import { RoadmapPlanningError, RoadmapPlanningRequest } from './roadmap-planner.provider';

// `fetch` is stubbed throughout: this suite is about the shape of the
// request we send and how we interpret what comes back, and a real call
// would be paid, slow and non-deterministic. Same technique as
// gemini-speech-to-text.provider.spec.ts.

const config = (values: Record<string, unknown> = {}): ConfigService =>
  ({
    get: (key: string, fallback?: unknown) =>
      key in values ? values[key] : fallback,
  }) as unknown as ConfigService;

const okResponse = (body: unknown): Response =>
  ({ ok: true, status: 200, json: () => Promise.resolve(body) }) as unknown as Response;

const okPlan = (
  phases: { resourceType: string; resourceId: string; reason: string }[],
  overallReason = 'Overall rationale.',
) =>
  okResponse({
    candidates: [
      { content: { parts: [{ text: JSON.stringify({ phases, overallReason }) }] } },
    ],
  });

const planningRequest: RoadmapPlanningRequest = {
  goal: 'FOUNDATION',
  estimatedLevel: 'A1',
  levelSource: 'BEGINNER_ASSUMED',
  sectionScores: null,
  candidates: [
    {
      resourceType: 'COURSE',
      id: 'foundation-grammar',
      pillar: 'GRAMMAR',
      level: 'A1',
      sortKey: 1704067200000,
      title: 'Ngữ pháp cơ bản',
      description: 'Basic grammar for beginners.',
      suitableGoals: ['FOUNDATION'],
    },
    {
      resourceType: 'VOCAB_LIBRARY',
      id: 'foundation-vocab',
      pillar: 'VOCABULARY',
      level: 'A1',
      sortKey: 4,
      title: '1000 Từ Tiếng Anh Thông Dụng',
      description: '1000 common English words.',
      suitableGoals: ['FOUNDATION'],
    },
    {
      resourceType: 'LISTENING_CATEGORY',
      id: 'daily-conversations',
      pillar: 'LISTENING',
      level: 'A1',
      sortKey: 3,
      title: 'Hội thoại hằng ngày',
      description: 'Daily Conversations',
      suitableGoals: ['FOUNDATION'],
    },
  ],
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe('GeminiRoadmapPlannerProvider', () => {
  it('sends only the given candidate ids/titles across all 3 pillars, and the anti-fabrication constraints', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      okPlan([
        { resourceType: 'COURSE', resourceId: 'foundation-grammar', reason: 'Fits your level.' },
      ]),
    );
    const provider = new GeminiRoadmapPlannerProvider(config({ GEMINI_API_KEY: 'k' }));

    await provider.plan(planningRequest);

    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    ) as { contents: { parts: { text?: string }[] }[] };
    const textParts = body.contents[0].parts.map((p) => p.text ?? '').join('\n');
    expect(textParts).toContain('foundation-grammar');
    expect(textParts).toContain('foundation-vocab');
    expect(textParts).toContain('daily-conversations');
    expect(textParts).toContain('COURSE');
    expect(textParts).toContain('VOCAB_LIBRARY');
    expect(textParts).toContain('LISTENING_CATEGORY');
    expect(textParts).toContain('never invent, rename, or reference any resource');
    expect(textParts).toMatch(
      /score, percentage, CEFR level, duration, lesson count, deck count, word count, or recording count/,
    );
  });

  it('the prompt describes SPEAKING_SCENARIO and instructs the model to always place it last', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      okPlan([
        { resourceType: 'COURSE', resourceId: 'foundation-grammar', reason: 'Fits your level.' },
      ]),
    );
    const provider = new GeminiRoadmapPlannerProvider(config({ GEMINI_API_KEY: 'k' }));

    await provider.plan(planningRequest);

    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    ) as { contents: { parts: { text?: string }[] }[] };
    const promptText = body.contents[0].parts[0].text ?? '';
    expect(promptText).toContain('SPEAKING_SCENARIO');
    expect(promptText).toMatch(/Speaking.*must always be placed LAST/);
  });

  it('the prompt asks for a short, bolded-keyword overallReason written directly to the student', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      okPlan([
        { resourceType: 'COURSE', resourceId: 'foundation-grammar', reason: 'Fits your level.' },
      ]),
    );
    const provider = new GeminiRoadmapPlannerProvider(config({ GEMINI_API_KEY: 'k' }));

    await provider.plan(planningRequest);

    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    ) as { contents: { parts: { text?: string }[] }[] };
    const promptText = body.contents[0].parts[0].text ?? '';
    expect(promptText).toContain('2-3 short sentences');
    expect(promptText).toContain('double asterisks');
    expect(promptText).toContain('bạn');
  });

  it('sends the API key as a header, never in the URL', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      okPlan([{ resourceType: 'COURSE', resourceId: 'foundation-grammar', reason: 'x' }]),
    );
    const provider = new GeminiRoadmapPlannerProvider(
      config({ GEMINI_API_KEY: 'secret-key' }),
    );

    await provider.plan(planningRequest);

    expect(fetchSpy.mock.calls[0][0] as string).not.toContain('secret-key');
    const headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Record<
      string,
      string
    >;
    expect(headers['x-goog-api-key']).toBe('secret-key');
  });

  it('asks for a deterministic, schema-shaped answer covering phases AND overallReason', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      okPlan([{ resourceType: 'COURSE', resourceId: 'foundation-grammar', reason: 'x' }]),
    );
    const provider = new GeminiRoadmapPlannerProvider(config({ GEMINI_API_KEY: 'k' }));

    await provider.plan(planningRequest);

    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    ) as {
      generationConfig: {
        temperature: number;
        responseMimeType: string;
        responseSchema: {
          required: string[];
          properties: { phases: { items: { required: string[] } } };
        };
      };
    };
    expect(body.generationConfig.temperature).toBe(0);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig.responseSchema.required).toEqual(
      expect.arrayContaining(['phases', 'overallReason']),
    );
    expect(body.generationConfig.responseSchema.properties.phases.items.required).toEqual(
      expect.arrayContaining(['resourceType', 'resourceId', 'reason']),
    );
  });

  it('reports a missing key as NOT_CONFIGURED without calling out', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const provider = new GeminiRoadmapPlannerProvider(config({}));

    await expect(provider.plan(planningRequest)).rejects.toMatchObject({
      kind: 'NOT_CONFIGURED',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reports a non-2xx response as unavailable', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: false, status: 500 } as unknown as Response);
    const provider = new GeminiRoadmapPlannerProvider(config({ GEMINI_API_KEY: 'k' }));

    await expect(provider.plan(planningRequest)).rejects.toMatchObject({
      kind: 'UNAVAILABLE',
    });
  });

  it('reports an aborted request as a timeout', async () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    jest.spyOn(global, 'fetch').mockRejectedValue(abort);
    const provider = new GeminiRoadmapPlannerProvider(config({ GEMINI_API_KEY: 'k' }));

    await expect(provider.plan(planningRequest)).rejects.toMatchObject({
      kind: 'TIMEOUT',
    });
  });

  it('reports a safety block as unavailable', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(okResponse({ promptFeedback: { blockReason: 'SAFETY' } }));
    const provider = new GeminiRoadmapPlannerProvider(config({ GEMINI_API_KEY: 'k' }));

    await expect(provider.plan(planningRequest)).rejects.toBeInstanceOf(
      RoadmapPlanningError,
    );
    await expect(provider.plan(planningRequest)).rejects.toMatchObject({
      kind: 'UNAVAILABLE',
    });
  });

  // Unlike STT's silence, an empty planning answer is not a legitimate
  // result — a roadmap needs at least one phase.
  it('reports an empty answer as unavailable rather than an empty plan', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      okResponse({ candidates: [{ content: { parts: [{ text: '' }] } }] }),
    );
    const provider = new GeminiRoadmapPlannerProvider(config({ GEMINI_API_KEY: 'k' }));

    await expect(provider.plan(planningRequest)).rejects.toMatchObject({
      kind: 'UNAVAILABLE',
    });
  });

  it('truncates a phase reason to MAX_REASON_CHARS before returning it', async () => {
    const longReason = 'x'.repeat(MAX_REASON_CHARS + 50);
    jest.spyOn(global, 'fetch').mockResolvedValue(
      okPlan([{ resourceType: 'COURSE', resourceId: 'foundation-grammar', reason: longReason }]),
    );
    const provider = new GeminiRoadmapPlannerProvider(config({ GEMINI_API_KEY: 'k' }));

    const result = await provider.plan(planningRequest);

    expect(result.phases[0].reason.length).toBeLessThanOrEqual(MAX_REASON_CHARS + 1); // +1 for a trailing ellipsis
  });

  it('truncates overallReason to MAX_OVERALL_REASON_CHARS before returning it', async () => {
    const longReason = 'y'.repeat(MAX_OVERALL_REASON_CHARS + 50);
    jest.spyOn(global, 'fetch').mockResolvedValue(
      okPlan(
        [{ resourceType: 'COURSE', resourceId: 'foundation-grammar', reason: 'x' }],
        longReason,
      ),
    );
    const provider = new GeminiRoadmapPlannerProvider(config({ GEMINI_API_KEY: 'k' }));

    const result = await provider.plan(planningRequest);

    expect(result.overallReason.length).toBeLessThanOrEqual(MAX_OVERALL_REASON_CHARS + 1);
  });
});

describe('extractPlan', () => {
  it('reads the schema-shaped answer', () => {
    const result = extractPlan(
      JSON.stringify({
        phases: [{ resourceType: 'COURSE', resourceId: 'c1', reason: 'Good fit.' }],
        overallReason: 'Overall.',
      }),
    );
    expect(result).toEqual({
      phases: [{ resourceType: 'COURSE', resourceId: 'c1', reason: 'Good fit.' }],
      overallReason: 'Overall.',
    });
  });

  it('throws UNAVAILABLE on unparseable JSON — no raw-text fallback for a structured plan', () => {
    expect(() => extractPlan('not json at all')).toThrow(RoadmapPlanningError);
    try {
      extractPlan('not json at all');
    } catch (error) {
      expect((error as RoadmapPlanningError).kind).toBe('UNAVAILABLE');
    }
  });

  it('throws UNAVAILABLE when the JSON is valid but has no phases array', () => {
    expect(() => extractPlan(JSON.stringify({ overallReason: 'x' }))).toThrow(
      RoadmapPlanningError,
    );
  });

  it('throws UNAVAILABLE when the JSON has phases but no overallReason string', () => {
    expect(() =>
      extractPlan(
        JSON.stringify({
          phases: [{ resourceType: 'COURSE', resourceId: 'c1', reason: 'x' }],
        }),
      ),
    ).toThrow(RoadmapPlanningError);
  });

  it('drops individual phase entries with a non-string resourceType/resourceId/reason, keeping the well-formed ones', () => {
    const result = extractPlan(
      JSON.stringify({
        phases: [
          { resourceType: 'COURSE', resourceId: 'c1', reason: 'Good fit.' },
          { resourceType: 'COURSE', resourceId: 123, reason: 'Bad shape.' },
          { resourceType: 'COURSE', resourceId: 'c2' }, // missing reason
        ],
        overallReason: 'Overall.',
      }),
    );
    expect(result.phases).toEqual([
      { resourceType: 'COURSE', resourceId: 'c1', reason: 'Good fit.' },
    ]);
  });

  // Structural parsing only checks resourceType is a string, not one of the
  // three known literals — an unrecognized value fails closed downstream in
  // validateRoadmapPlan's allow-list (no candidate key will ever match it),
  // not here.
  it('does not reject an unrecognized resourceType at the parsing layer', () => {
    const result = extractPlan(
      JSON.stringify({
        phases: [{ resourceType: 'SOMETHING_ELSE', resourceId: 'c1', reason: 'x' }],
        overallReason: 'Overall.',
      }),
    );
    expect(result.phases).toHaveLength(1);
  });
});

describe('truncateReason', () => {
  it('leaves a short reason untouched', () => {
    expect(truncateReason('Fits your level.')).toBe('Fits your level.');
  });

  it('cuts at the last sentence boundary when one exists past the midpoint', () => {
    const text = `${'a'.repeat(120)}. ${'b'.repeat(120)}`;
    const result = truncateReason(text);
    expect(result.length).toBeLessThanOrEqual(MAX_REASON_CHARS);
    expect(result.endsWith('.')).toBe(true);
  });

  it('falls back to a hard cut with an ellipsis when no good sentence boundary exists', () => {
    const text = 'x'.repeat(MAX_REASON_CHARS + 50);
    const result = truncateReason(text);
    expect(result.endsWith('…')).toBe(true);
    expect(result.length).toBeLessThanOrEqual(MAX_REASON_CHARS + 1);
  });
});

describe('truncateOverallReason', () => {
  it('leaves a short reason untouched', () => {
    expect(truncateOverallReason('Fits your level.')).toBe('Fits your level.');
  });

  it('falls back to a hard cut with an ellipsis when no good sentence boundary exists', () => {
    const text = 'x'.repeat(MAX_OVERALL_REASON_CHARS + 50);
    const result = truncateOverallReason(text);
    expect(result.endsWith('…')).toBe(true);
    expect(result.length).toBeLessThanOrEqual(MAX_OVERALL_REASON_CHARS + 1);
  });
});
