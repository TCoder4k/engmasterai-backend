import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DictionarySourceError,
  DictionarySourceLookup,
  DictionarySourceMeaning,
  DictionarySourceProvider,
} from './dictionary-source.provider';

// Dictionary Phase A — the external EN dictionary source.
//
// >>> WHY freedictionaryapi.com, NOT api.dictionaryapi.dev <<<
// The two are separate, unrelated services despite the similar name. Verified
// directly (live requests + published docs, not prior knowledge) before
// picking one: api.dictionaryapi.dev's own site states no clear license/
// attribution terms for the returned data, and its maintainer's README
// describes real difficulty keeping the server funded — a genuine production
// reliability risk. freedictionaryapi.com publishes a documented rate limit
// (1,000 req/hour/IP), a clear CC BY-SA 4.0 / Wiktionary license, and embeds
// `source.url` + `source.license` in every response — attribution the UI can
// render from live data instead of a hand-maintained static line.
//
// PLAIN `fetch`, NO SDK, matching every other external provider here.
//
// >>> "NOT FOUND" IS HTTP 200 WITH `entries: []`, NOT 404 <<<
// Verified by calling the live endpoint with a nonsense word. This is the
// opposite of what most REST dictionaries do, and getting it wrong would
// have meant treating "no such word" as a provider failure (503) instead of
// the honest, expected 404 this endpoint is supposed to give.
//
// >>> NO AUDIO FIELD EXISTS ON THIS SOURCE <<<
// `pronunciations` carries IPA text only, never a URL. This is a real limit
// of the data source, not a design choice — `audioUrl` stays null for every
// lookup that reaches this tier (see dictionary.service.ts).

const FREE_DICTIONARY_API_BASE = 'https://freedictionaryapi.com/api/v1/entries/en';

const MAX_MEANINGS = 3;
const MAX_SYNONYMS = 10;

interface RawPronunciation {
  type?: string;
  text?: string;
  tags?: string[];
}

interface RawSense {
  definition?: string;
  examples?: string[];
}

interface RawEntry {
  partOfSpeech?: string;
  pronunciations?: RawPronunciation[];
  senses?: RawSense[];
  synonyms?: string[];
}

interface RawResponse {
  word?: string;
  entries?: RawEntry[];
  source?: { url?: string };
}

@Injectable()
export class FreeDictionaryApiProvider implements DictionarySourceProvider {
  private readonly logger = new Logger(FreeDictionaryApiProvider.name);

  constructor(private readonly config: ConfigService) {}

  async lookup(word: string): Promise<DictionarySourceLookup> {
    const timeoutMs = this.config.get<number>(
      'DICTIONARY_SOURCE_TIMEOUT_MS',
      8000,
    );

    // A bounded wait, always — see every other provider in this codebase.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(
        `${FREE_DICTIONARY_API_BASE}/${encodeURIComponent(word)}`,
        { method: 'GET', signal: controller.signal },
      );
    } catch (caught) {
      const aborted = caught instanceof Error && caught.name === 'AbortError';
      this.logger.warn(
        `freedictionaryapi.com lookup ${aborted ? 'timed out' : 'failed'} after ${timeoutMs}ms`,
      );
      throw new DictionarySourceError(
        aborted ? 'TIMEOUT' : 'UNAVAILABLE',
        aborted ? 'Dictionary source timed out' : 'Dictionary source is unavailable',
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      this.logger.warn(`freedictionaryapi.com returned HTTP ${response.status}`);
      throw new DictionarySourceError(
        'UNAVAILABLE',
        `Dictionary source failed with status ${response.status}`,
      );
    }

    let payload: RawResponse;
    try {
      payload = (await response.json()) as RawResponse;
    } catch {
      throw new DictionarySourceError(
        'UNAVAILABLE',
        'Dictionary source returned no data',
      );
    }

    const entries = payload.entries ?? [];
    // The verified "not found" signal — an empty array on a 200, never a 404
    // from the upstream service itself.
    if (entries.length === 0) {
      throw new DictionarySourceError('NOT_FOUND', `No dictionary entry for "${word}"`);
    }

    return {
      word: payload.word ?? word,
      ipa: extractIpa(entries),
      meanings: extractMeanings(entries),
      synonyms: extractSynonyms(entries),
      sourceUrl: payload.source?.url ?? null,
    };
  }
}

/** Prefers a "General American" tagged IPA entry; falls back to the first one seen. Exported for tests. */
export const extractIpa = (entries: RawEntry[]): string | null => {
  let firstIpa: string | null = null;
  for (const entry of entries) {
    for (const pron of entry.pronunciations ?? []) {
      if (pron.type !== 'ipa' || !pron.text) continue;
      if (!firstIpa) firstIpa = pron.text;
      if (pron.tags?.includes('General American')) return pron.text;
    }
  }
  return firstIpa;
};

/** Exported for tests. */
export const extractMeanings = (entries: RawEntry[]): DictionarySourceMeaning[] => {
  const meanings: DictionarySourceMeaning[] = [];
  for (const entry of entries) {
    const sense = entry.senses?.find((s) => typeof s.definition === 'string');
    if (!sense?.definition) continue;
    meanings.push({
      partOfSpeech: entry.partOfSpeech ?? null,
      definitionEn: sense.definition,
      exampleEn: sense.examples?.[0] ?? null,
    });
    if (meanings.length >= MAX_MEANINGS) break;
  }
  return meanings;
};

/** Exported for tests. */
export const extractSynonyms = (entries: RawEntry[]): string[] => {
  const seen = new Set<string>();
  for (const entry of entries) {
    for (const synonym of entry.synonyms ?? []) {
      seen.add(synonym);
      if (seen.size >= MAX_SYNONYMS) return [...seen];
    }
  }
  return [...seen];
};
