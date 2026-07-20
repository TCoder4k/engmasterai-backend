import { Injectable } from '@nestjs/common';
import * as path from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { ImportWord } from '../types/import-word';
import { DatasetConfig } from '../types/dataset-config';
import { ValidationReport, ValidationIssue } from '../types/artifacts';
import { MappingIssue } from '../mappers/mapper.interface';
import { normalizeDedupeKey } from './normalizers';
import { matchLocalFile } from '../media/media-matcher';
import { slugify } from '../media/slug';
import { AUDIO_EXTENSIONS, IMAGE_EXTENSIONS } from '../media/media-extensions';
import { FRAMEWORK_VERSION } from '../version';

// Field caps mirror CreateVocabWordDto exactly (approved plan §4) so a word
// that passes here also satisfies the editor DTO — one validation
// vocabulary, not two.
const TEXT_MAX = 100;
const IPA_MAX = 100;
const MEANING_MAX = 10;
const MEANING_TEXT_MAX = 500;
const EXAMPLE_MAX = 10;
const EXAMPLE_TEXT_MAX = 500;
const ARRAY_MAX = 20;
const ARRAY_ITEM_MAX = 100;
const HTTPS_URL_PATTERN = /^https:\/\//i;
const IPA_LOOSE_PATTERN = /^\/.*\/$/;

@Injectable()
export class ImportValidatorService {
  constructor(private readonly prismaService: PrismaService) {}

  async validate(
    words: ImportWord[],
    mapperIssues: MappingIssue[],
    config: DatasetConfig,
    runId: string,
  ): Promise<ValidationReport> {
    const errors: ValidationIssue[] = mapperIssues.map((issue) => ({ ...issue }));
    const warnings: ValidationIssue[] = [];

    for (const word of words) {
      this.validateStructural(word, errors, warnings);
      this.validateMedia(word, config, warnings);
    }

    const inFileDuplicates = this.findInFileDuplicates(words);
    for (const dup of inFileDuplicates) {
      warnings.push({
        row: dup.rows[0],
        text: dup.text,
        message: `Duplicate within this file (rows ${dup.rows.join(', ')}) — only the first is imported`,
      });
    }

    const dbDuplicates = await this.findDbDuplicates(words);
    for (const dup of dbDuplicates) {
      warnings.push({ row: 0, text: dup.text, message: `Already exists in the database (id ${dup.existingId})` });
    }

    return {
      runId,
      datasetId: config.id,
      generatedAt: new Date().toISOString(),
      frameworkVersion: FRAMEWORK_VERSION,
      totalWords: words.length,
      errors,
      warnings,
      inFileDuplicates,
      dbDuplicates,
    };
  }

  private validateStructural(word: ImportWord, errors: ValidationIssue[], warnings: ValidationIssue[]): void {
    const row = word.source.row;
    const text = word.text;

    if (!text || text.length === 0) {
      errors.push({ row, message: 'Missing text' });
      return;
    }
    if (text.length > TEXT_MAX) {
      errors.push({ row, text, message: `text exceeds ${TEXT_MAX} characters` });
    }
    if (word.ipa && word.ipa.length > IPA_MAX) {
      errors.push({ row, text, message: `ipa exceeds ${IPA_MAX} characters` });
    }
    if (word.ipa && !IPA_LOOSE_PATTERN.test(word.ipa)) {
      warnings.push({ row, text, message: `ipa "${word.ipa}" doesn't look like /slashed/ notation` });
    }

    if (word.meanings.length === 0) {
      errors.push({ row, text, message: 'No meanings — a word must have at least one' });
    }
    if (word.meanings.length > MEANING_MAX) {
      errors.push({ row, text, message: `${word.meanings.length} meanings exceeds the cap of ${MEANING_MAX}` });
    }
    word.meanings.forEach((m) => {
      if (m.meaning.length > MEANING_TEXT_MAX) {
        errors.push({ row, text, message: `A meaning exceeds ${MEANING_TEXT_MAX} characters` });
      }
    });

    if (word.examples.length === 0) {
      warnings.push({ row, text, message: 'No examples' });
    }
    if (word.examples.length > EXAMPLE_MAX) {
      errors.push({ row, text, message: `${word.examples.length} examples exceeds the cap of ${EXAMPLE_MAX}` });
    }
    word.examples.forEach((e) => {
      if (e.sentence.length > EXAMPLE_TEXT_MAX) {
        errors.push({ row, text, message: `An example sentence exceeds ${EXAMPLE_TEXT_MAX} characters` });
      }
      if (e.translation && e.translation.length > EXAMPLE_TEXT_MAX) {
        errors.push({ row, text, message: `An example translation exceeds ${EXAMPLE_TEXT_MAX} characters` });
      }
    });

    for (const [field, values] of [
      ['synonyms', word.synonyms],
      ['antonyms', word.antonyms],
      ['collocations', word.collocations],
      ['wordFamily', word.wordFamily],
    ] as const) {
      if (values.length > ARRAY_MAX) {
        errors.push({ row, text, message: `${field} has ${values.length} items, exceeding the cap of ${ARRAY_MAX}` });
      }
      values.forEach((v) => {
        if (v.length > ARRAY_ITEM_MAX) {
          errors.push({ row, text, message: `A ${field} entry exceeds ${ARRAY_ITEM_MAX} characters` });
        }
      });
    }

    for (const [field, ref] of [
      ['audio', word.media.audio],
      ['image', word.media.image],
    ] as const) {
      if (ref?.remoteUrl && !HTTPS_URL_PATTERN.test(ref.remoteUrl)) {
        errors.push({ row, text, message: `${field} remote URL must be https` });
      }
    }
  }

  private validateMedia(word: ImportWord, config: DatasetConfig, warnings: ValidationIssue[]): void {
    const row = word.source.row;
    const text = word.text;
    const deckKey = word.deckKey ?? '';

    for (const [kind, source, extensions] of [
      ['audio', config.media?.audio, AUDIO_EXTENSIONS],
      ['image', config.media?.image, IMAGE_EXTENSIONS],
    ] as const) {
      if (!source) continue;

      const remoteUrl = kind === 'audio' ? word.media.audio?.remoteUrl : word.media.image?.remoteUrl;
      if (remoteUrl) continue; // remote fallback exists — nothing to warn about

      const slug = slugify(text, source.slug);
      const dir = path.join(source.root, deckKey);
      const match = matchLocalFile(dir, slug, extensions);
      if (match.matchType === 'none') {
        warnings.push({ row, text, message: `No ${kind} available (no local file and no remote URL)` });
      }
    }
  }

  private findInFileDuplicates(words: ImportWord[]): { text: string; rows: number[] }[] {
    const rowsByKey = new Map<string, { text: string; rows: number[] }>();
    for (const word of words) {
      const key = normalizeDedupeKey(word.text);
      const existing = rowsByKey.get(key);
      if (existing) {
        existing.rows.push(word.source.row);
      } else {
        rowsByKey.set(key, { text: word.text, rows: [word.source.row] });
      }
    }
    return Array.from(rowsByKey.values()).filter((v) => v.rows.length > 1);
  }

  private async findDbDuplicates(words: ImportWord[]): Promise<{ text: string; existingId: string }[]> {
    const candidateKeys = new Map<string, string>();
    for (const word of words) {
      candidateKeys.set(normalizeDedupeKey(word.text), word.text);
    }

    // Scoped IN query, not the existing CSV importer's full-table scan
    // (approved plan §7/§9 — this is the fix for the Phase-2 audit's Medium
    // finding, applied to the new code path). mode: 'insensitive' on the IN
    // filter keeps this consistent with the case-insensitive dedupe
    // contract without requiring a second in-JS lowercase comparison pass.
    const existing = await this.prismaService.vocabWord.findMany({
      where: { text: { in: Array.from(candidateKeys.values()), mode: 'insensitive' } },
      select: { id: true, text: true },
    });

    return existing
      .filter((w) => candidateKeys.has(normalizeDedupeKey(w.text)))
      .map((w) => ({ text: w.text, existingId: w.id }));
  }
}
