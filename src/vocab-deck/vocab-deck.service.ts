import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateVocabDeckDto } from './dto/create-vocab-deck.dto';
import { UpdateVocabDeckDto } from './dto/update-vocab-deck.dto';
import { AttachVocabDeckWordsDto } from './dto/attach-vocab-deck-words.dto';

// Structural cap on every deck's word count (see the approved Phase 2 plan
// §4/M1) — keeps the unpaginated student deck-word response bounded, not
// just behaviorally curated.
const MAX_DECK_WORDS = 500;

// No isPublished here — the auth'd read only ever returns published decks,
// so the field would be redundant on that response (mirrors
// LessonService.USER_SELECT omitting it for the same reason).
// _count.deckWords closes Phase 1's Handoff #1 (real word counts, not
// fabricated stats) for both the student and admin shapes below.
const USER_SELECT = {
  id: true,
  libraryId: true,
  name: true,
  description: true,
  thumbnail: true,
  cefrLevel: true,
  orderIndex: true,
  createdAt: true,
  updatedAt: true,
  _count: {
    select: { deckWords: true },
  },
};

const MANAGE_SELECT = {
  ...USER_SELECT,
  isPublished: true,
};

@Injectable()
export class VocabDeckService {
  constructor(private readonly prismaService: PrismaService) {}

  // The Phase-1 scope-cut endpoint, now with its consumer (DeckDetailPage).
  // Single query with a nested library.isPublished check (Lesson's
  // findOnePublished pattern) rather than two separate loads.
  async findOnePublished(id: string, _user: { userId: string }) {
    const deck = await this.prismaService.vocabDeck.findUnique({
      where: { id },
      select: {
        ...USER_SELECT,
        isPublished: true,
        library: { select: { isPublished: true } },
      },
    });

    if (!deck || !deck.isPublished || !deck.library.isPublished) {
      throw new NotFoundException(`Vocabulary deck with ID ${id} not found`);
    }

    // isPublished/library are selected only to run the check above — the
    // response shape stays USER_SELECT (no isPublished), same reasoning as
    // Phase 1's omission of it from the auth'd read.
    const { library: _library, isPublished: _isPublished, ...rest } = deck;
    return rest;
  }

  // Deck's words for the student dictionary-mode reader — behind the same
  // deck+library published check as findOnePublished. Unpaginated `{ data }`
  // (decks are curated study units), and now structurally bounded by
  // MAX_DECK_WORDS (see attachWords below).
  async findWordsByDeck(deckId: string, user: { userId: string }) {
    await this.assertDeckAccessibleToUser(deckId, user);

    const deckWords = await this.prismaService.vocabDeckWord.findMany({
      where: { deckId },
      orderBy: { orderIndex: 'asc' },
      select: {
        word: {
          select: {
            id: true,
            text: true,
            ipa: true,
            cefrLevel: true,
            audioUrl: true,
            imageUrl: true,
            meanings: {
              select: { id: true, partOfSpeech: true, meaning: true, orderIndex: true },
              orderBy: { orderIndex: 'asc' },
            },
          },
        },
      },
    });

    return { data: deckWords.map((dw) => dw.word) };
  }

  // Admin — all attached words plus their deck position, regardless of the
  // deck's publish state.
  async findWordsByDeckManage(deckId: string) {
    await this.findOneOrThrow(deckId);

    const deckWords = await this.prismaService.vocabDeckWord.findMany({
      where: { deckId },
      orderBy: { orderIndex: 'asc' },
      select: {
        orderIndex: true,
        word: {
          select: {
            id: true,
            text: true,
            cefrLevel: true,
            meanings: {
              select: { meaning: true },
              orderBy: { orderIndex: 'asc' },
              take: 1,
            },
          },
        },
      },
    });

    return { data: deckWords };
  }

  // Batch attach (see the approved Phase 2 plan §4/§5). The incoming array
  // is deduplicated first; the existence check, the MAX_DECK_WORDS cap, and
  // the response counts all operate on the deduplicated set, so repeated
  // ids in one request can't cause a false 400 or a miscounted report.
  async attachWords(deckId: string, dto: AttachVocabDeckWordsDto) {
    await this.findOneOrThrow(deckId);

    const uniqueWordIds = Array.from(new Set(dto.wordIds));

    const existingWords = await this.prismaService.vocabWord.findMany({
      where: { id: { in: uniqueWordIds } },
      select: { id: true },
    });
    const existingWordIds = new Set(existingWords.map((w) => w.id));
    const missingIds = uniqueWordIds.filter((id) => !existingWordIds.has(id));
    if (missingIds.length > 0) {
      throw new BadRequestException(`Word(s) not found: ${missingIds.join(', ')}`);
    }

    const alreadyAttached = await this.prismaService.vocabDeckWord.findMany({
      where: { deckId, wordId: { in: uniqueWordIds } },
      select: { wordId: true },
    });
    const alreadyAttachedIds = new Set(alreadyAttached.map((dw) => dw.wordId));
    const toAttach = uniqueWordIds.filter((id) => !alreadyAttachedIds.has(id));

    if (toAttach.length > 0) {
      const currentCount = await this.prismaService.vocabDeckWord.count({ where: { deckId } });
      if (currentCount + toAttach.length > MAX_DECK_WORDS) {
        throw new BadRequestException(
          `Attaching these words would exceed the maximum deck size of ${MAX_DECK_WORDS} words.`,
        );
      }

      const maxOrderIndex = await this.prismaService.vocabDeckWord.aggregate({
        where: { deckId },
        _max: { orderIndex: true },
      });
      let nextOrderIndex = (maxOrderIndex._max.orderIndex ?? -1) + 1;

      // skipDuplicates as a race-safety backstop — the @@unique([deckId,
      // wordId]) constraint makes a concurrent attach of the same pair safe
      // even though we've already filtered it out above.
      await this.prismaService.vocabDeckWord.createMany({
        data: toAttach.map((wordId) => ({ deckId, wordId, orderIndex: nextOrderIndex++ })),
        skipDuplicates: true,
      });
    }

    return {
      data: {
        attachedCount: toAttach.length,
        skippedCount: uniqueWordIds.length - toAttach.length,
      },
    };
  }

  // 400 if this is the last word of a published deck — detaching to zero
  // would recreate, through a side door, the empty-published state the
  // publish guard exists to prevent. Draft decks detach freely.
  async detachWord(deckId: string, wordId: string): Promise<void> {
    const deck = await this.findOneOrThrow(deckId);

    const deckWord = await this.prismaService.vocabDeckWord.findUnique({
      where: { deckId_wordId: { deckId, wordId } },
    });
    if (!deckWord) {
      throw new NotFoundException(`Word ${wordId} is not attached to deck ${deckId}`);
    }

    if (deck.isPublished) {
      const count = await this.prismaService.vocabDeckWord.count({ where: { deckId } });
      if (count <= 1) {
        throw new BadRequestException(
          'Cannot detach the last word of a published deck. Unpublish it first.',
        );
      }
    }

    await this.prismaService.vocabDeckWord.delete({
      where: { deckId_wordId: { deckId, wordId } },
    });
  }

  async findPublishedByLibrary(libraryId: string, user: { userId: string }) {
    await this.assertLibraryAccessibleToUser(libraryId, user);

    const decks = await this.prismaService.vocabDeck.findMany({
      where: { libraryId, isPublished: true },
      orderBy: { orderIndex: 'asc' },
      select: USER_SELECT,
    });

    return { data: decks };
  }

  async findAllByLibraryManage(libraryId: string) {
    await this.assertLibraryExists(libraryId);

    const decks = await this.prismaService.vocabDeck.findMany({
      where: { libraryId },
      orderBy: { orderIndex: 'asc' },
      select: MANAGE_SELECT,
    });

    return { data: decks };
  }

  async create(libraryId: string, dto: CreateVocabDeckDto) {
    await this.assertLibraryExists(libraryId);

    const maxOrderIndex = await this.prismaService.vocabDeck.aggregate({
      where: { libraryId },
      _max: { orderIndex: true },
    });
    const orderIndex = (maxOrderIndex._max.orderIndex ?? -1) + 1;

    // Construct the Prisma payload explicitly rather than spreading the DTO —
    // the global ValidationPipe has no whitelist, so extra properties could
    // otherwise reach the database. Decks always start as unpublished drafts
    // at the end of the library's ordering; neither is settable here.
    return this.prismaService.vocabDeck.create({
      data: {
        libraryId,
        name: dto.name,
        description: dto.description,
        thumbnail: dto.thumbnail,
        cefrLevel: dto.cefrLevel,
        orderIndex,
      },
      select: MANAGE_SELECT,
    });
  }

  async update(id: string, dto: UpdateVocabDeckDto) {
    await this.findOneOrThrow(id);

    // Same reasoning as create(): only these fields are ever writable through
    // this endpoint. isPublished/orderIndex/libraryId are intentionally excluded.
    return this.prismaService.vocabDeck.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.thumbnail !== undefined && { thumbnail: dto.thumbnail }),
        ...(dto.cefrLevel !== undefined && { cefrLevel: dto.cefrLevel }),
      },
      select: MANAGE_SELECT,
    });
  }

  // Handoff #2 closed: a deck can no longer publish with zero words.
  // Additive-only — nothing sweeps or retroactively unpublishes a Phase-1
  // deck that was already published empty under the old rule (see the
  // approved plan's accepted publish/detach race note: this guard is an
  // action-time guarantee, not a continuous invariant).
  async publish(id: string) {
    await this.findOneOrThrow(id);

    const wordCount = await this.prismaService.vocabDeckWord.count({ where: { deckId: id } });
    if (wordCount === 0) {
      throw new BadRequestException(
        'Cannot publish a deck with no words. Attach at least one word first.',
      );
    }

    return this.prismaService.vocabDeck.update({
      where: { id },
      data: { isPublished: true },
      select: MANAGE_SELECT,
    });
  }

  async unpublish(id: string) {
    await this.findOneOrThrow(id);

    return this.prismaService.vocabDeck.update({
      where: { id },
      data: { isPublished: false },
      select: MANAGE_SELECT,
    });
  }

  // Returns void: the controller responds 204 No Content.
  //
  // Deliberately deviates from Course/Lesson's delete-guard shape: those
  // block on *children existing*; this blocks on *live state* (isPublished).
  // Kept intentionally, not aligned to match Course — production insurance
  // against an admin accidentally deleting a catalog entry students are
  // actively browsing. Once Phase 2 adds DeckWord, this guard stays as-is;
  // a separate children-exist check can be layered alongside it if that
  // turns out to be warranted too.
  async remove(id: string): Promise<void> {
    const deck = await this.findOneOrThrow(id);

    if (deck.isPublished) {
      throw new BadRequestException(
        'Cannot delete a published deck. Unpublish it first.',
      );
    }

    await this.prismaService.vocabDeck.delete({ where: { id } });
  }

  private async findOneOrThrow(id: string) {
    const deck = await this.prismaService.vocabDeck.findUnique({ where: { id } });
    if (!deck) {
      throw new NotFoundException(`Vocabulary deck with ID ${id} not found`);
    }
    return deck;
  }

  private async assertLibraryExists(libraryId: string) {
    const library = await this.prismaService.vocabLibrary.findUnique({
      where: { id: libraryId },
    });
    if (!library) {
      throw new NotFoundException(`Vocabulary library with ID ${libraryId} not found`);
    }
    return library;
  }

  // Access seam: the single place that decides whether a user may see a
  // library's decks. Today this only checks the library is published; named
  // to mirror LessonService.assertCourseAccessibleToUser even though there
  // is no enrollment rule yet — a future one plugs in here without touching
  // callers.
  private async assertLibraryAccessibleToUser(libraryId: string, _user: { userId: string }) {
    const library = await this.prismaService.vocabLibrary.findUnique({
      where: { id: libraryId },
    });
    if (!library || !library.isPublished) {
      throw new NotFoundException(`Vocabulary library with ID ${libraryId} not found`);
    }
    return library;
  }

  // Same seam shape as assertLibraryAccessibleToUser, one level down: a
  // deck's words are visible only if the deck AND its library are both
  // published.
  private async assertDeckAccessibleToUser(deckId: string, _user: { userId: string }) {
    const deck = await this.prismaService.vocabDeck.findUnique({
      where: { id: deckId },
      select: { id: true, isPublished: true, library: { select: { isPublished: true } } },
    });

    if (!deck || !deck.isPublished || !deck.library.isPublished) {
      throw new NotFoundException(`Vocabulary deck with ID ${deckId} not found`);
    }

    return deck;
  }
}
