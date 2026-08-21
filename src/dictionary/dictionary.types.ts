// Shared response shape for GET /dictionary/lookup — used by the service,
// the Redis cache store and (implicitly) the controller's return type.

export type DictionarySourceKind = 'VOCAB_WORD' | 'DICTIONARY_CACHE' | 'EXTERNAL';

export type ViTranslationSource = 'NONE' | 'AI' | 'CURATED';

export interface DictionaryLookupMeaning {
  partOfSpeech: string | null;
  definitionEn: string | null;
  /**
   * A curated Vietnamese sense, populated ONLY for a VOCAB_WORD hit (from
   * VocabWordMeaning.meaning, a required field — every meaning row has one).
   * Always null for DICTIONARY_CACHE/EXTERNAL, which only ever AI-translate
   * the FIRST definition into the top-level `viTranslation`, not one
   * translation per meaning.
   */
  definitionVi: string | null;
  exampleEn: string | null;
}

export interface DictionaryLookupResult {
  word: string;
  normalizedWord: string;
  ipa: string | null;
  audioUrl: string | null;
  meanings: DictionaryLookupMeaning[];
  synonyms: string[];
  viTranslation: string | null;
  viTranslationSource: ViTranslationSource;
  sourceUrl: string | null;
  source: DictionarySourceKind;
  vocabWordId: string | null;
}

// GET /dictionary/suggestions — VocabWord-only, prefix autocomplete. Deliberately
// thin (no ipa/audio/etc.): this is a typeahead list, not a lookup result: the
// full DictionaryLookupResult only comes from GET /dictionary/lookup once the
// student selects a suggestion or submits.
export interface DictionarySuggestion {
  word: string;
  shortMeaningVi: string | null;
}
