import { ConfigService } from '@nestjs/config';
import {
  FreeDictionaryApiProvider,
  extractIpa,
  extractMeanings,
  extractSynonyms,
} from './free-dictionary-api.provider';
import { DictionarySourceError } from './dictionary-source.provider';

// `fetch` is stubbed throughout — this suite is about the shape of the
// request we send and how we interpret what freedictionaryapi.com sends
// back, verified against the live API's actual response shape before this
// provider was written (see the file's own header comment).

const config = (values: Record<string, unknown> = {}): ConfigService =>
  ({
    get: (key: string, fallback?: unknown) =>
      key in values ? values[key] : fallback,
  }) as unknown as ConfigService;

const okResponse = (body: unknown): Response =>
  ({ ok: true, status: 200, json: () => Promise.resolve(body) }) as unknown as Response;

const helloEntries = [
  {
    partOfSpeech: 'interjection',
    pronunciations: [
      { type: 'ipa', text: '/hɛˈloʊ/', tags: ['General American'] },
      { type: 'ipa', text: '/həˈləʊ/', tags: ['Received Pronunciation'] },
    ],
    senses: [{ definition: 'Used as a greeting.', examples: ['Hello, world!'] }],
    synonyms: ['hi', 'hey'],
  },
  {
    partOfSpeech: 'noun',
    pronunciations: [{ type: 'ipa', text: '/həˈləʊ/', tags: ['Received Pronunciation'] }],
    senses: [{ definition: 'An utterance of "hello".' }],
    synonyms: ['greeting'],
  },
];

afterEach(() => {
  jest.restoreAllMocks();
});

describe('FreeDictionaryApiProvider', () => {
  it('maps a real-shaped response into the deterministic lookup shape', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      okResponse({
        word: 'hello',
        entries: helloEntries,
        source: { url: 'https://en.wiktionary.org/wiki/hello' },
      }),
    );
    const provider = new FreeDictionaryApiProvider(config());

    const result = await provider.lookup('hello');

    expect(result.word).toBe('hello');
    expect(result.ipa).toBe('/hɛˈloʊ/'); // General American tag wins
    expect(result.meanings).toHaveLength(2);
    expect(result.meanings[0]).toEqual({
      partOfSpeech: 'interjection',
      definitionEn: 'Used as a greeting.',
      exampleEn: 'Hello, world!',
    });
    expect(result.synonyms).toEqual(expect.arrayContaining(['hi', 'hey', 'greeting']));
    expect(result.sourceUrl).toBe('https://en.wiktionary.org/wiki/hello');
  });

  // Verified against the live API: an unknown word is HTTP 200 with an
  // empty `entries` array, never a 404 from the upstream service itself.
  it('treats a 200 with empty entries as NOT_FOUND', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      okResponse({
        word: 'asdfghjklzxcvbnm',
        entries: [],
        source: { url: 'https://en.wiktionary.org' },
      }),
    );
    const provider = new FreeDictionaryApiProvider(config());

    await expect(provider.lookup('asdfghjklzxcvbnm')).rejects.toMatchObject({
      kind: 'NOT_FOUND',
    });
  });

  it('reports an aborted request as TIMEOUT', async () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    jest.spyOn(global, 'fetch').mockRejectedValue(abort);
    const provider = new FreeDictionaryApiProvider(config());

    await expect(provider.lookup('hello')).rejects.toMatchObject({ kind: 'TIMEOUT' });
  });

  it('reports a network failure as UNAVAILABLE', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('offline'));
    const provider = new FreeDictionaryApiProvider(config());

    await expect(provider.lookup('hello')).rejects.toBeInstanceOf(DictionarySourceError);
  });

  it('reports a non-2xx response as UNAVAILABLE', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 500 } as unknown as Response);
    const provider = new FreeDictionaryApiProvider(config());

    await expect(provider.lookup('hello')).rejects.toMatchObject({ kind: 'UNAVAILABLE' });
  });

  it('never sends an API key — the source needs none', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      okResponse({ word: 'hi', entries: helloEntries, source: {} }),
    );
    const provider = new FreeDictionaryApiProvider(config());

    await provider.lookup('hi');

    const [, init] = fetchSpy.mock.calls[0];
    expect((init as RequestInit | undefined)?.headers).toBeUndefined();
  });
});

describe('extractIpa', () => {
  it('prefers a General American tagged pronunciation', () => {
    expect(extractIpa(helloEntries)).toBe('/hɛˈloʊ/');
  });

  it('falls back to the first IPA seen when no General American tag exists', () => {
    const entries = [
      { pronunciations: [{ type: 'ipa', text: '/wɜːd/', tags: ['British'] }] },
    ];
    expect(extractIpa(entries)).toBe('/wɜːd/');
  });

  it('returns null when there is no ipa pronunciation at all', () => {
    expect(extractIpa([{ pronunciations: [] }])).toBeNull();
  });
});

describe('extractMeanings', () => {
  it('caps at 3 meanings even with more entries', () => {
    const entries = Array.from({ length: 5 }, (_, i) => ({
      partOfSpeech: 'noun',
      senses: [{ definition: `def ${i}` }],
    }));
    expect(extractMeanings(entries)).toHaveLength(3);
  });

  it('skips entries with no definition in any sense', () => {
    const entries = [
      { partOfSpeech: 'noun', senses: [{ examples: ['no definition here'] }] },
      { partOfSpeech: 'verb', senses: [{ definition: 'a real one' }] },
    ];
    expect(extractMeanings(entries)).toEqual([
      { partOfSpeech: 'verb', definitionEn: 'a real one', exampleEn: null },
    ]);
  });
});

describe('extractSynonyms', () => {
  it('de-duplicates across entries and caps at 10', () => {
    const entries = Array.from({ length: 15 }, (_, i) => ({ synonyms: [`syn${i}`, 'shared'] }));
    const result = extractSynonyms(entries);
    expect(result.length).toBeLessThanOrEqual(10);
    expect(new Set(result).size).toBe(result.length);
  });
});
