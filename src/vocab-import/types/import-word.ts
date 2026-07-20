import { CefrLevel, PartOfSpeech } from '@prisma/client';

// The single normalized shape every stage after the mapper consumes. Field
// caps mirror CreateVocabWordDto exactly (see create-vocab-word.dto.ts) so
// anything that passes validation here also satisfies the editor DTO — one
// validation vocabulary, not two.
export interface ImportWordMeaning {
  partOfSpeech?: PartOfSpeech;
  meaning: string;
}

export interface ImportWordExample {
  sentence: string;
  translation?: string;
}

export interface ImportWordMediaRef {
  localPath?: string;
  remoteUrl?: string;
}

export interface ImportWord {
  text: string;
  ipa?: string;
  cefrLevel?: CefrLevel;
  meanings: ImportWordMeaning[];
  examples: ImportWordExample[];
  synonyms: string[];
  antonyms: string[];
  collocations: string[];
  wordFamily: string[];
  media: {
    audio?: ImportWordMediaRef;
    image?: ImportWordMediaRef;
  };
  deckKey?: string;
  source: { datasetId: string; row: number };
}
