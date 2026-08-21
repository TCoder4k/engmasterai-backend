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
import { DictionaryLookupResult, DictionarySuggestion } from './dictionary.types';

const MEANING_SELECT = { partOfSpeech: true, meaning: true, orderIndex: true };
const EXAMPLE_SELECT = { sentence: true, orderIndex: true };
const MAX_VOCAB_WORD_MEANINGS = 3;
export const DEFAULT_SUGGESTION_LIMIT = 6;

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

  /**
   * Autocomplete — VocabWord only, no cache tier and no external/AI call.
   * A typeahead firing on every debounced keystroke must never touch
   * freedictionaryapi.com or Gemini; it can only ever surface words this
   * app already curated. Exact lookup (with its 3 tiers) still runs
   * separately once the student selects a suggestion or submits.
   */
  async suggest(rawPrefix: string, limit: number): Promise<DictionarySuggestion[]> {
    const normalizedPrefix = rawPrefix.trim().toLowerCase();

    const words = await this.prisma.vocabWord.findMany({
      where: { text: { startsWith: normalizedPrefix, mode: 'insensitive' } },
      select: {
        text: true,
        meanings: {
          select: { meaning: true },
          orderBy: { orderIndex: 'asc' },
          take: 1,
        },
      },
      orderBy: { text: 'asc' },
      take: limit,
    });

    return words.map((word) => ({
      word: word.text,
      shortMeaningVi: word.meanings[0]?.meaning ?? null,
    }));
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
      // Vietnamese meaning (required on every VocabWordMeaning row, hence
      // `definitionVi` below) and an English example sentence. `definitionEn`
      // stays null here — genuinely absent, not just unpopulated — per this
      // codebase's "do not display a field the source cannot reliably
      // provide" rule.
      meanings: word.meanings.map((m, index) => ({
        partOfSpeech: m.partOfSpeech ? m.partOfSpeech.toLowerCase() : null,
        definitionEn: null,
        definitionVi: m.meaning,
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
      // definitionVi is per-meaning and only ever populated for a VOCAB_WORD
      // hit (see lookupVocabWord) — this tier only AI-translates the FIRST
      // definition, into the top-level `viTranslation` above, not one
      // translation per meaning.
      meanings: sourceLookup.meanings.map((m) => ({ ...m, definitionVi: null })),
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
