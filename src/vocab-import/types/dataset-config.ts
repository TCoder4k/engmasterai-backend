import { WordSource } from '@prisma/client';

export type RawFileFormat = 'csv' | 'xlsx' | 'json';

export interface MeaningColumnConfig {
  from: string;
  posFrom?: string;
}

export interface ExampleColumnConfig {
  sentence: string;
  translation?: string;
}

export interface ColumnMapConfig {
  text: string;
  ipa?: string;
  cefrLevel?: string;
  meanings: MeaningColumnConfig[];
  examples?: ExampleColumnConfig[];
  synonyms?: string;
  antonyms?: string;
  collocations?: string;
  wordFamily?: string;
}

// Prefix-glob local-file matching, corrected against the real toeic600 media
// folders (see the approved plan §6/§8): filenames are not a fixed
// {text}1.<ext> pattern — some have no numeric suffix, some have a "2", some
// don't exist at all. The resolver tries slug(text).<ext> exactly, then the
// alphabetically-first file matching slug(text)\d*\.<ext>, then falls back
// to remoteUrl. "underscoreSpaces" is the only slug strategy needed today;
// more can be added here without touching the resolver's matching logic.
export type SlugStrategy = 'none' | 'underscoreSpaces';

export interface MediaSourceConfig {
  root: string;
  slug?: SlugStrategy;
  remoteUrlColumn?: string;
}

export interface DatasetMediaConfig {
  audio?: MediaSourceConfig;
  image?: MediaSourceConfig;
}

export interface DatasetConfig {
  id: string;
  mapper: string;
  importSource: WordSource;
  files: {
    table: string;
    format?: RawFileFormat;
    sheet?: string;
  };
  library: {
    name: string;
    description: string;
  };
  deckFrom: { column: string } | { fixed: string };
  columns: ColumnMapConfig;
  multiValueSeparator?: string;
  posAliases?: Record<string, string>;
  cefrAliases?: Record<string, string>;
  media?: DatasetMediaConfig;
}
