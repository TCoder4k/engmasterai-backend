import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DictionaryCacheStore } from './dictionary-cache.store';
import { DICTIONARY_SOURCE_PROVIDER, DictionarySourceError } from './dictionary-source.provider';
// `import type` because these providers are injected by TOKEN, not by class:
// with `emitDecoratorMetadata` a value import here would make TypeScript
// emit a runtime reference to an interface that does not exist at runtime —
// same convention as ShadowingService's own provider imports.
import type { DictionarySourceProvider } from './dictionary-source.provider';
import { VI_TRANSLATION_PROVIDER, ViTranslationError } from './vi-translation.provider';
import type { ViTranslationProvider } from './vi-translation.provider';
import { DictionaryLookupResult } from './dictionary.types';

const MEANING_SELECT = { partOfSpeech: true, meaning: true, orderIndex: true };
const EXAMPLE_SELECT = { sentence: true, orderIndex: true };
const MAX_VOCAB_WORD_MEANINGS = 3;

@Injectable()
export class DictionaryService {
  private readonly logger = new Logger(DictionaryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: DictionaryCacheStore,
    @Inject(DICTIONARY_SOURCE_PROVIDER)
    private readonly source: DictionarySourceProvider,
    @Inject(VI_TRANSLATION_PROVIDER)
    private readonly viTranslation: ViTranslationProvider,
  ) {}

  /**
   * Three tiers, cache-forward — see docs/CLAUDE.md's Dictionary section.
   *
   * 1. VocabWord (curated, already has a real Vietnamese meaning — no AI call).
   * 2. Redis cache (a prior tier-3 answer for this exact normalized word).
   * 3. freedictionaryapi.com, then Gemini for the Vietnamese line only.
   *
   * Never fabricates an English definition: a genuine miss on every tier is
   * an honest 404, not a model-invented answer.
   */
  async lookup(rawQuery: string): Promise<DictionaryLookupResult> {
    const normalizedWord = rawQuery.trim().toLowerCase();

    const fromVocabWord = await this.lookupVocabWord(normalizedWord);
    if (fromVocabWord) return fromVocabWord;

    const cached = await this.cache.get(normalizedWord);
    if (cached) return { ...cached, source: 'DICTIONARY_CACHE' };

    return this.lookupExternal(rawQuery, normalizedWord);
  }

  private async lookupVocabWord(
    normalizedWord: string,
  ): Promise<DictionaryLookupResult | null> {
    const word = await this.prisma.vocabWord.findFirst({
      where: { text: { equals: normalizedWord, mode: 'insensitive' } },
      select: {
        id: true,
        text: true,
        ipa: true,
        audioUrl: true,
        synonyms: true,
        meanings: {
          select: MEANING_SELECT,
          orderBy: { orderIndex: 'asc' },
          take: MAX_VOCAB_WORD_MEANINGS,
        },
        examples: {
          select: EXAMPLE_SELECT,
          orderBy: { orderIndex: 'asc' },
          take: MAX_VOCAB_WORD_MEANINGS,
        },
      },
    });
    if (!word) return null;

    const firstMeaning = word.meanings[0];

    return {
      word: word.text,
      normalizedWord,
      ipa: word.ipa,
      audioUrl: word.audioUrl,
      // No English definition is stored on VocabWord — only a curated
      // Vietnamese meaning and an English example sentence. Leaving
      // definitionEn null here is honest, not a bug: this codebase's own
      // rule is "do not display a field the source cannot reliably provide".
      meanings: word.meanings.map((m, index) => ({
        partOfSpeech: m.partOfSpeech ? m.partOfSpeech.toLowerCase() : null,
        definitionEn: null,
        exampleEn: word.examples[index]?.sentence ?? null,
      })),
      synonyms: word.synonyms,
      viTranslation: firstMeaning?.meaning ?? null,
      // CURATED, not AI: this came from admin-authored content, which is
      // more trustworthy than a translation the model produced — and costs
      // nothing extra to serve.
      viTranslationSource: firstMeaning ? 'CURATED' : 'NONE',
      sourceUrl: null,
      source: 'VOCAB_WORD',
      vocabWordId: word.id,
    };
  }

  private async lookupExternal(
    displayWord: string,
    normalizedWord: string,
  ): Promise<DictionaryLookupResult> {
    let sourceLookup;
    try {
      sourceLookup = await this.source.lookup(normalizedWord);
    } catch (error) {
      if (error instanceof DictionarySourceError) {
        if (error.kind === 'NOT_FOUND') {
          throw new NotFoundException(`No dictionary entry for "${displayWord}"`);
        }
        throw new ServiceUnavailableException(
          'Dictionary source is temporarily unavailable',
        );
      }
      throw error;
    }

    const firstDefinition = sourceLookup.meanings[0]?.definitionEn;
    let viTranslation: string | null = null;
    let viTranslationSource: DictionaryLookupResult['viTranslationSource'] = 'NONE';

    if (firstDefinition) {
      try {
        const translated = await this.viTranslation.translate({
          word: sourceLookup.word,
          definitionEn: firstDefinition,
        });
        viTranslation = translated.translation;
        viTranslationSource = 'AI';
      } catch (error) {
        // Partial success beats total failure here — the English side is
        // real and useful even without a Vietnamese line. Never let a
        // translation failure turn an otherwise-good lookup into a 503.
        if (error instanceof ViTranslationError) {
          this.logger.warn(
            `VI translation failed for "${normalizedWord}": ${error.kind}`,
          );
        } else {
          throw error;
        }
      }
    }

    const result: DictionaryLookupResult = {
      word: sourceLookup.word,
      normalizedWord,
      ipa: sourceLookup.ipa,
      // Never populated from this tier — see free-dictionary-api.provider.ts.
      audioUrl: null,
      meanings: sourceLookup.meanings,
      synonyms: sourceLookup.synonyms,
      viTranslation,
      viTranslationSource,
      sourceUrl: sourceLookup.sourceUrl,
      source: 'EXTERNAL',
      vocabWordId: null,
    };

    // Cached regardless of whether translation succeeded (viTranslation may
    // be null) so a later lookup of the same word never repeats BOTH
    // external calls for a translation that may keep failing.
    await this.cache.set(normalizedWord, result);

    return result;
  }
}
