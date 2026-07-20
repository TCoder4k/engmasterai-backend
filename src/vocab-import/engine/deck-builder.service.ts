import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ImportWord } from '../types/import-word';
import { DatasetConfig } from '../types/dataset-config';
import { normalizeDedupeKey } from '../validation/normalizers';

// Structural cap on every deck's word count — same rule as
// VocabDeckService.attachWords (§9). Real datasets seen so far top out
// around a dozen words per topic, so this only ever matters for a future,
// much larger dataset with a poorly chosen deckFrom column.
const MAX_DECK_WORDS = 500;
const DRY_RUN_LIBRARY_ID = '<dry-run-library>';

export interface DeckBuilderResult {
  decksCreated: number;
  decksReused: number;
  attached: number;
  unattachedNoDeckKey: string[];
}

@Injectable()
export class DeckBuilderService {
  private readonly logger = new Logger(DeckBuilderService.name);

  constructor(private readonly prismaService: PrismaService) {}

  async build(
    words: ImportWord[],
    wordIdByNormalizedText: Map<string, string>,
    config: DatasetConfig,
    dryRun: boolean,
  ): Promise<DeckBuilderResult> {
    const libraryId = await this.getOrCreateLibrary(config, dryRun);

    const groups = new Map<string, ImportWord[]>();
    const unattachedNoDeckKey: string[] = [];

    for (const word of words) {
      if (!word.deckKey) {
        unattachedNoDeckKey.push(word.text);
        continue;
      }
      const group = groups.get(word.deckKey) ?? [];
      group.push(word);
      groups.set(word.deckKey, group);
    }

    let decksCreated = 0;
    let decksReused = 0;
    let attached = 0;

    for (const [deckKey, deckWords] of groups) {
      const { deckId, created } = await this.getOrCreateDeck(libraryId, deckKey, dryRun);
      if (created) decksCreated++;
      else decksReused++;

      const wordIds = deckWords
        .map((w) => wordIdByNormalizedText.get(normalizeDedupeKey(w.text)))
        .filter((id): id is string => Boolean(id));

      attached += await this.attachWords(deckId, wordIds, dryRun);
    }

    return { decksCreated, decksReused, attached, unattachedNoDeckKey };
  }

  private async getOrCreateLibrary(config: DatasetConfig, dryRun: boolean): Promise<string> {
    const existing = await this.prismaService.vocabLibrary.findFirst({
      where: { name: config.library.name },
      select: { id: true },
    });
    if (existing) return existing.id;
    if (dryRun) return DRY_RUN_LIBRARY_ID;

    const maxOrderIndex = await this.prismaService.vocabLibrary.aggregate({ _max: { orderIndex: true } });
    const created = await this.prismaService.vocabLibrary.create({
      data: {
        name: config.library.name,
        description: config.library.description,
        orderIndex: (maxOrderIndex._max.orderIndex ?? -1) + 1,
      },
      select: { id: true },
    });
    return created.id;
  }

  private async getOrCreateDeck(
    libraryId: string,
    deckKey: string,
    dryRun: boolean,
  ): Promise<{ deckId: string; created: boolean }> {
    if (libraryId !== DRY_RUN_LIBRARY_ID) {
      const existing = await this.prismaService.vocabDeck.findFirst({
        where: { libraryId, name: deckKey },
        select: { id: true },
      });
      if (existing) return { deckId: existing.id, created: false };
    }

    if (dryRun) return { deckId: `<dry-run-deck:${deckKey}>`, created: true };

    const maxOrderIndex = await this.prismaService.vocabDeck.aggregate({
      where: { libraryId },
      _max: { orderIndex: true },
    });
    const created = await this.prismaService.vocabDeck.create({
      data: {
        libraryId,
        name: deckKey,
        orderIndex: (maxOrderIndex._max.orderIndex ?? -1) + 1,
      },
      select: { id: true },
    });
    return { deckId: created.id, created: true };
  }

  // skipDuplicates as a race backstop, matching VocabDeckService.attachWords
  // — the @@unique([deckId, wordId]) constraint makes a concurrent attach
  // of the same pair safe even though duplicates are already filtered here.
  private async attachWords(deckId: string, wordIds: string[], dryRun: boolean): Promise<number> {
    if (wordIds.length === 0) return 0;

    const isRealDeck = !deckId.startsWith('<dry-run-deck:');
    const alreadyAttachedIds = isRealDeck
      ? new Set(
          (
            await this.prismaService.vocabDeckWord.findMany({
              where: { deckId, wordId: { in: wordIds } },
              select: { wordId: true },
            })
          ).map((dw) => dw.wordId),
        )
      : new Set<string>();

    const toAttach = wordIds.filter((id) => !alreadyAttachedIds.has(id));
    if (toAttach.length === 0) return 0;

    const currentCount = isRealDeck
      ? await this.prismaService.vocabDeckWord.count({ where: { deckId } })
      : 0;
    const capacity = Math.max(0, MAX_DECK_WORDS - currentCount);
    const bounded = toAttach.slice(0, capacity);
    if (bounded.length < toAttach.length) {
      this.logger.warn(
        `Deck ${deckId} would exceed the ${MAX_DECK_WORDS}-word cap — ${toAttach.length - bounded.length} word(s) left unattached`,
      );
    }

    if (dryRun || !isRealDeck) return bounded.length;

    const maxOrderIndex = await this.prismaService.vocabDeckWord.aggregate({
      where: { deckId },
      _max: { orderIndex: true },
    });
    let nextOrderIndex = (maxOrderIndex._max.orderIndex ?? -1) + 1;

    await this.prismaService.vocabDeckWord.createMany({
      data: bounded.map((wordId) => ({ deckId, wordId, orderIndex: nextOrderIndex++ })),
      skipDuplicates: true,
    });

    return bounded.length;
  }
}
