import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateVocabDeckDto } from './dto/create-vocab-deck.dto';
import { UpdateVocabDeckDto } from './dto/update-vocab-deck.dto';

// No isPublished here — the auth'd read only ever returns published decks,
// so the field would be redundant on that response (mirrors
// LessonService.USER_SELECT omitting it for the same reason).
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
};

// No _count yet: DeckWord doesn't exist until Phase 2, so a word count
// can't be selected here. Added in Phase 2 alongside DeckWord, in the same
// place Course's _count.lessons lives.
const MANAGE_SELECT = {
  ...USER_SELECT,
  isPublished: true,
};

@Injectable()
export class VocabDeckService {
  constructor(private readonly prismaService: PrismaService) {}

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

  async publish(id: string) {
    await this.findOneOrThrow(id);

    // No content guard this phase — DeckWord doesn't exist until Phase 2, so
    // there is nothing yet to check a deck has "≥1 word" against. Phase 2
    // adds that guard for newly published decks; a deck already published
    // empty here stays published (additive guards don't retroactively
    // unpublish).
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
}
