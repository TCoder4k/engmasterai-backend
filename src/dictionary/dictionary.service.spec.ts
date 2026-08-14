import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { DictionaryService } from './dictionary.service';
import { DictionarySourceError } from './dictionary-source.provider';
import { ViTranslationError } from './vi-translation.provider';

// This suite is about TIER ORDER and the "never fabricate" guarantee — every
// external/AI call is a mock, so it proves the service's own logic, not any
// provider's behaviour (those have their own spec files).

const buildService = (overrides: {
  vocabWordFindFirst?: jest.Mock;
  cacheGet?: jest.Mock;
  cacheSet?: jest.Mock;
  sourceLookup?: jest.Mock;
  translate?: jest.Mock;
}) => {
  const prisma = {
    vocabWord: { findFirst: overrides.vocabWordFindFirst ?? jest.fn().mockResolvedValue(null) },
  };
  const cache = {
    get: overrides.cacheGet ?? jest.fn().mockResolvedValue(null),
    set: overrides.cacheSet ?? jest.fn().mockResolvedValue(undefined),
  };
  const source = { lookup: overrides.sourceLookup ?? jest.fn() };
  const viTranslation = { translate: overrides.translate ?? jest.fn() };

  const service = new DictionaryService(
    prisma as never,
    cache as never,
    source as never,
    viTranslation as never,
  );

  return { service, prisma, cache, source, viTranslation };
};

describe('DictionaryService.lookup', () => {
  it('tier 1: returns a VocabWord hit without touching cache, source or AI', async () => {
    const { service, cache, source, viTranslation } = buildService({
      vocabWordFindFirst: jest.fn().mockResolvedValue({
        id: 'word-1',
        text: 'apple',
        ipa: '/ˈæpəl/',
        audioUrl: 'https://cdn/apple.mp3',
        synonyms: ['fruit'],
        meanings: [{ partOfSpeech: 'NOUN', meaning: 'quả táo', orderIndex: 0 }],
        examples: [{ sentence: 'I ate an apple.', orderIndex: 0 }],
      }),
    });

    const result = await service.lookup('apple');

    expect(result.source).toBe('VOCAB_WORD');
    expect(result.vocabWordId).toBe('word-1');
    expect(result.audioUrl).toBe('https://cdn/apple.mp3');
    expect(result.viTranslation).toBe('quả táo');
    expect(result.viTranslationSource).toBe('CURATED');
    // Honest about what VocabWord cannot provide, per this codebase's own
    // "do not display a field the source cannot reliably provide" rule.
    expect(result.meanings[0].definitionEn).toBeNull();
    expect(result.meanings[0].exampleEn).toBe('I ate an apple.');
    expect(cache.get).not.toHaveBeenCalled();
    expect(source.lookup).not.toHaveBeenCalled();
    expect(viTranslation.translate).not.toHaveBeenCalled();
  });

  it('tier 2: returns a cache hit without touching the external source or AI', async () => {
    const cached = {
      word: 'hello',
      normalizedWord: 'hello',
      ipa: '/hɛˈloʊ/',
      audioUrl: null,
      meanings: [{ partOfSpeech: 'interjection', definitionEn: 'A greeting.', exampleEn: null }],
      synonyms: ['hi'],
      viTranslation: 'Xin chào',
      viTranslationSource: 'AI' as const,
      sourceUrl: 'https://en.wiktionary.org/wiki/hello',
      source: 'EXTERNAL' as const,
      vocabWordId: null,
    };
    const { service, source, viTranslation } = buildService({
      cacheGet: jest.fn().mockResolvedValue(cached),
    });

    const result = await service.lookup('hello');

    expect(result.source).toBe('DICTIONARY_CACHE');
    expect(result.viTranslation).toBe('Xin chào');
    expect(source.lookup).not.toHaveBeenCalled();
    expect(viTranslation.translate).not.toHaveBeenCalled();
  });

  it('tier 3: fetches the external source, translates, and caches the result', async () => {
    const { service, cache, source, viTranslation } = buildService({
      sourceLookup: jest.fn().mockResolvedValue({
        word: 'hello',
        ipa: '/hɛˈloʊ/',
        meanings: [{ partOfSpeech: 'interjection', definitionEn: 'A greeting.', exampleEn: null }],
        synonyms: ['hi'],
        sourceUrl: 'https://en.wiktionary.org/wiki/hello',
      }),
      translate: jest.fn().mockResolvedValue({ translation: 'Xin chào' }),
    });

    const result = await service.lookup('hello');

    expect(result.source).toBe('EXTERNAL');
    expect(result.audioUrl).toBeNull();
    expect(result.viTranslation).toBe('Xin chào');
    expect(result.viTranslationSource).toBe('AI');
    expect(cache.set).toHaveBeenCalledWith('hello', expect.objectContaining({ source: 'EXTERNAL' }));
  });

  it('a translation failure degrades to a 200 with no Vietnamese line, not a 503', async () => {
    const { service, cache } = buildService({
      sourceLookup: jest.fn().mockResolvedValue({
        word: 'hello',
        ipa: null,
        meanings: [{ partOfSpeech: 'interjection', definitionEn: 'A greeting.', exampleEn: null }],
        synonyms: [],
        sourceUrl: null,
      }),
      translate: jest.fn().mockRejectedValue(new ViTranslationError('UNAVAILABLE', 'down')),
    });

    const result = await service.lookup('hello');

    expect(result.viTranslation).toBeNull();
    expect(result.viTranslationSource).toBe('NONE');
    expect(result.meanings[0].definitionEn).toBe('A greeting.');
    // Still cached — a future lookup should not repeat the (failing) AI call
    // just to get the same English answer again.
    expect(cache.set).toHaveBeenCalled();
  });

  it('a genuine miss on every tier is an honest 404, never a fabricated definition', async () => {
    const { service } = buildService({
      sourceLookup: jest
        .fn()
        .mockRejectedValue(new DictionarySourceError('NOT_FOUND', 'no entry')),
    });

    await expect(service.lookup('asdfghjkl')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('an external source outage is a 503, not a fabricated definition', async () => {
    const { service } = buildService({
      sourceLookup: jest
        .fn()
        .mockRejectedValue(new DictionarySourceError('UNAVAILABLE', 'down')),
    });

    await expect(service.lookup('hello')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
