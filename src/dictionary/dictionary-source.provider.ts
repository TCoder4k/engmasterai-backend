// Tier 3 of the Dictionary lookup (see dictionary.service.ts) — the external,
// deterministic English source. A string DI token, matching every other
// Gemini/external provider in this codebase (the interface is a type and
// erases at runtime).
export const DICTIONARY_SOURCE_PROVIDER = 'DICTIONARY_SOURCE_PROVIDER';

export interface DictionarySourceMeaning {
  partOfSpeech: string | null;
  definitionEn: string;
  exampleEn: string | null;
}

export interface DictionarySourceLookup {
  word: string;
  ipa: string | null;
  meanings: DictionarySourceMeaning[];
  synonyms: string[];
  /** Link to the exact page this definition came from, for attribution. */
  sourceUrl: string | null;
}

/**
 * Everything that can go wrong, as far as the caller needs to care.
 *
 * NOT_FOUND is a normal, expected outcome (a word that genuinely has no
 * entry) — deliberately not the same case as UNAVAILABLE/TIMEOUT, which are
 * source failures. dictionary.service.ts maps NOT_FOUND to an honest 404 and
 * the other two to a 503, never to a fabricated definition either way.
 */
export type DictionarySourceFailureKind = 'UNAVAILABLE' | 'TIMEOUT' | 'NOT_FOUND';

export class DictionarySourceError extends Error {
  constructor(
    readonly kind: DictionarySourceFailureKind,
    message: string,
  ) {
    super(message);
    this.name = 'DictionarySourceError';
  }
}

export interface DictionarySourceProvider {
  lookup(word: string): Promise<DictionarySourceLookup>;
}
