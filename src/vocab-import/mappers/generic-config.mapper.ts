import { CefrLevel, PartOfSpeech } from '@prisma/client';
import { DatasetConfig } from '../types/dataset-config';
import { ImportWord, ImportWordMeaning } from '../types/import-word';
import { RawTable } from '../types/raw-table';
import { DatasetMapper, MapResult, MappingIssue } from './mapper.interface';
import { splitMultiValue, resolveAlias } from '../validation/normalizers';
import { getDeckKey } from './deck-key';

// Config-driven default (approved plan §6): most datasets need zero code —
// just a column map + alias tables. This is format conversion ONLY: no
// filesystem access (that's the media resolver's job in stage 4), no DB,
// no validation beyond "was this cell present" — the validator (stage 3)
// owns every business rule (≥1 meaning, field caps, enum finality).
export class GenericConfigMapper implements DatasetMapper {
  readonly id = 'generic';

  map(table: RawTable, config: DatasetConfig): MapResult {
    const words: ImportWord[] = [];
    const issues: MappingIssue[] = [];
    const separator = config.multiValueSeparator ?? '|';

    table.rows.forEach((row, index) => {
      const rowNumber = index + 2; // header row + 1-indexing, matches the existing CSV importer's convention
      const text = (row[config.columns.text] ?? '').trim();

      if (!text) {
        issues.push({ row: rowNumber, message: `Missing value in headword column "${config.columns.text}"` });
        return;
      }

      const ipa = config.columns.ipa ? row[config.columns.ipa]?.trim() || undefined : undefined;

      let cefrLevel: CefrLevel | undefined;
      if (config.columns.cefrLevel) {
        const raw = row[config.columns.cefrLevel];
        const resolved = resolveAlias(raw, config.cefrAliases);
        if (resolved.unmapped) {
          issues.push({ row: rowNumber, text, message: `Unrecognized CEFR value "${raw}"` });
        } else {
          cefrLevel = resolved.value as CefrLevel | undefined;
        }
      }

      const meanings: ImportWordMeaning[] = [];
      for (const meaningConfig of config.columns.meanings) {
        const meaning = row[meaningConfig.from]?.trim();
        if (!meaning) continue; // absent for this row — not every dataset fills every meaning column

        let partOfSpeech: PartOfSpeech | undefined;
        if (meaningConfig.posFrom) {
          const raw = row[meaningConfig.posFrom];
          const resolved = resolveAlias(raw, config.posAliases);
          if (resolved.unmapped) {
            issues.push({ row: rowNumber, text, message: `Unrecognized part-of-speech value "${raw}"` });
          } else {
            partOfSpeech = resolved.value as PartOfSpeech | undefined;
          }
        }

        meanings.push({ meaning, partOfSpeech });
      }

      const examples = (config.columns.examples ?? [])
        .map((exampleConfig) => {
          const sentence = row[exampleConfig.sentence]?.trim();
          if (!sentence) return undefined;
          const translation = exampleConfig.translation
            ? row[exampleConfig.translation]?.trim() || undefined
            : undefined;
          return { sentence, translation };
        })
        .filter((e): e is { sentence: string; translation: string | undefined } => e !== undefined);

      const synonyms = config.columns.synonyms ? splitMultiValue(row[config.columns.synonyms], separator) : [];
      const antonyms = config.columns.antonyms ? splitMultiValue(row[config.columns.antonyms], separator) : [];
      const collocations = config.columns.collocations
        ? splitMultiValue(row[config.columns.collocations], separator)
        : [];
      const wordFamily = config.columns.wordFamily
        ? splitMultiValue(row[config.columns.wordFamily], separator)
        : [];

      const audioRemoteUrl = config.media?.audio?.remoteUrlColumn
        ? row[config.media.audio.remoteUrlColumn]?.trim() || undefined
        : undefined;
      const imageRemoteUrl = config.media?.image?.remoteUrlColumn
        ? row[config.media.image.remoteUrlColumn]?.trim() || undefined
        : undefined;

      words.push({
        text,
        ipa,
        cefrLevel,
        meanings,
        examples,
        synonyms,
        antonyms,
        collocations,
        wordFamily,
        media: {
          audio: audioRemoteUrl ? { remoteUrl: audioRemoteUrl } : undefined,
          image: imageRemoteUrl ? { remoteUrl: imageRemoteUrl } : undefined,
        },
        deckKey: getDeckKey(row, config.deckFrom) || undefined,
        source: { datasetId: config.id, row: rowNumber },
      });
    });

    return { words, issues };
  }
}
