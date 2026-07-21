import { Injectable, Logger } from '@nestjs/common';
import { WordSource } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ImportWord } from '../types/import-word';
import { MediaManifest } from '../types/artifacts';
import { normalizeDedupeKey } from '../validation/normalizers';

// Existing words that were themselves created by an import more than this
// long ago and never touched since (updatedAt ~ createdAt) are still safe
// to upsert. Anything edited since — including a media re-upload, which
// also bumps @updatedAt — is protected (approved plan §9's fix for the
// "source alone is insufficient" gap found during plan review).
const PROTECTED_EPSILON_MS = 5000;

export interface ImportEngineOptions {
  mode: 'skip' | 'upsert';
  dryRun: boolean;
  forceOverwrite: boolean;
  importSource: WordSource;
}

export interface ImportEngineResult {
  wordIdByNormalizedText: Map<string, string>;
  created: number;
  updated: number;
  skipped: number;
  skippedProtected: number;
  failed: { text: string; row: number; error: string }[];
}

interface ExistingWordRow {
  id: string;
  text: string;
  source: WordSource;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class ImportEngineService {
  private readonly logger = new Logger(ImportEngineService.name);

  constructor(private readonly prismaService: PrismaService) {}

  async import(
    words: ImportWord[],
    manifest: MediaManifest | undefined,
    options: ImportEngineOptions,
  ): Promise<ImportEngineResult> {
    const { deduped, duplicateCount } = this.dedupeByText(words);

    const candidateTexts = deduped.map((w) => w.text);
    const existing = await this.prismaService.vocabWord.findMany({
      where: { text: { in: candidateTexts, mode: 'insensitive' } },
      select: {
        id: true,
        text: true,
        source: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    const existingByKey = new Map<string, ExistingWordRow>(
      existing.map((w) => [normalizeDedupeKey(w.text), w]),
    );

    const wordIdByNormalizedText = new Map<string, string>();
    const toCreate: ImportWord[] = [];
    const toUpdate: { word: ImportWord; existingId: string }[] = [];

    let skipped = duplicateCount;
    let skippedProtected = 0;

    for (const word of deduped) {
      const key = normalizeDedupeKey(word.text);
      const existingRow = existingByKey.get(key);

      if (!existingRow) {
        toCreate.push(word);
        continue;
      }

      if (options.mode === 'skip') {
        skipped++;
        wordIdByNormalizedText.set(key, existingRow.id);
        continue;
      }

      const isEdited =
        existingRow.updatedAt.getTime() - existingRow.createdAt.getTime() >
        PROTECTED_EPSILON_MS;
      const isProtected = existingRow.source === WordSource.ADMIN || isEdited;

      if (isProtected && !options.forceOverwrite) {
        skippedProtected++;
        wordIdByNormalizedText.set(key, existingRow.id);
        continue;
      }

      toUpdate.push({ word, existingId: existingRow.id });
    }

    const failed: { text: string; row: number; error: string }[] = [];
    let created = 0;
    let updated = 0;

    if (options.dryRun) {
      // Placeholder ids for the deck builder's preview — real ids for
      // words that already exist (so an attach preview against the real
      // DB stays accurate), synthetic ids for words that would be created.
      for (const word of toCreate) {
        wordIdByNormalizedText.set(
          normalizeDedupeKey(word.text),
          `<dry-run:${word.text}>`,
        );
      }
      for (const { word, existingId } of toUpdate) {
        wordIdByNormalizedText.set(normalizeDedupeKey(word.text), existingId);
      }
      created = toCreate.length;
      updated = toUpdate.length;
    } else {
      for (const word of toCreate) {
        try {
          const id = await this.createWord(
            word,
            manifest,
            options.importSource,
          );
          wordIdByNormalizedText.set(normalizeDedupeKey(word.text), id);
          created++;
        } catch (err) {
          failed.push({
            text: word.text,
            row: word.source.row,
            error: (err as Error).message,
          });
        }
      }

      for (const { word, existingId } of toUpdate) {
        try {
          await this.updateWord(existingId, word, manifest);
          wordIdByNormalizedText.set(normalizeDedupeKey(word.text), existingId);
          updated++;
        } catch (err) {
          failed.push({
            text: word.text,
            row: word.source.row,
            error: (err as Error).message,
          });
        }
      }
    }

    return {
      wordIdByNormalizedText,
      created,
      updated,
      skipped,
      skippedProtected,
      failed,
    };
  }

  // Keeps the first occurrence of each normalized text — same convention as
  // the existing CSV importer (later duplicates are skips, not errors).
  private dedupeByText(words: ImportWord[]): {
    deduped: ImportWord[];
    duplicateCount: number;
  } {
    const seen = new Set<string>();
    const deduped: ImportWord[] = [];
    let duplicateCount = 0;

    for (const word of words) {
      const key = normalizeDedupeKey(word.text);
      if (seen.has(key)) {
        duplicateCount++;
        continue;
      }
      seen.add(key);
      deduped.push(word);
    }

    return { deduped, duplicateCount };
  }

  private getMediaUrl(
    manifest: MediaManifest | undefined,
    text: string,
    kind: 'audio' | 'image',
  ): string | undefined {
    if (!manifest) return undefined;
    const key = normalizeDedupeKey(text);
    const entry = manifest.entries.find(
      (e) => e.kind === kind && e.textKey === key,
    );
    return entry?.status === 'uploaded' ? entry.secureUrl : undefined;
  }

  // Explicit field mapping, never spread — same rule as
  // VocabWordService.create (the global ValidationPipe has no whitelist).
  private async createWord(
    word: ImportWord,
    manifest: MediaManifest | undefined,
    source: WordSource,
  ): Promise<string> {
    return this.prismaService.$transaction(async (tx) => {
      const created = await tx.vocabWord.create({
        data: {
          text: word.text,
          ipa: word.ipa,
          audioUrl: this.getMediaUrl(manifest, word.text, 'audio'),
          imageUrl: this.getMediaUrl(manifest, word.text, 'image'),
          cefrLevel: word.cefrLevel,
          synonyms: word.synonyms,
          antonyms: word.antonyms,
          collocations: word.collocations,
          wordFamily: word.wordFamily,
          source,
        },
      });

      if (word.meanings.length > 0) {
        await tx.vocabWordMeaning.createMany({
          data: word.meanings.map((m, orderIndex) => ({
            wordId: created.id,
            partOfSpeech: m.partOfSpeech,
            meaning: m.meaning,
            orderIndex,
          })),
        });
      }

      if (word.examples.length > 0) {
        await tx.vocabWordExample.createMany({
          data: word.examples.map((e, orderIndex) => ({
            wordId: created.id,
            sentence: e.sentence,
            translation: e.translation,
            orderIndex,
          })),
        });
      }

      return created.id;
    });
  }

  // Replace-all semantics for meanings/examples — same as
  // VocabWordService.update. Media URLs are filled only if currently null:
  // an import must never clobber an admin-uploaded asset on an
  // already-imported word that passed the protection check above.
  private async updateWord(
    id: string,
    word: ImportWord,
    manifest: MediaManifest | undefined,
  ): Promise<void> {
    await this.prismaService.$transaction(async (tx) => {
      const current = await tx.vocabWord.findUniqueOrThrow({
        where: { id },
        select: { audioUrl: true, imageUrl: true },
      });

      const audioUrl =
        current.audioUrl ?? this.getMediaUrl(manifest, word.text, 'audio');
      const imageUrl =
        current.imageUrl ?? this.getMediaUrl(manifest, word.text, 'image');

      await tx.vocabWord.update({
        where: { id },
        data: {
          text: word.text,
          ipa: word.ipa,
          audioUrl,
          imageUrl,
          cefrLevel: word.cefrLevel,
          synonyms: word.synonyms,
          antonyms: word.antonyms,
          collocations: word.collocations,
          wordFamily: word.wordFamily,
        },
      });

      await tx.vocabWordMeaning.deleteMany({ where: { wordId: id } });
      if (word.meanings.length > 0) {
        await tx.vocabWordMeaning.createMany({
          data: word.meanings.map((m, orderIndex) => ({
            wordId: id,
            partOfSpeech: m.partOfSpeech,
            meaning: m.meaning,
            orderIndex,
          })),
        });
      }

      await tx.vocabWordExample.deleteMany({ where: { wordId: id } });
      if (word.examples.length > 0) {
        await tx.vocabWordExample.createMany({
          data: word.examples.map((e, orderIndex) => ({
            wordId: id,
            sentence: e.sentence,
            translation: e.translation,
            orderIndex,
          })),
        });
      }
    });
  }
}
