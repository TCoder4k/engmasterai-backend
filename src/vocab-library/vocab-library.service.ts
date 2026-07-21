import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateVocabLibraryDto } from './dto/create-vocab-library.dto';
import { UpdateVocabLibraryDto } from './dto/update-vocab-library.dto';

const PUBLIC_SELECT = {
  id: true,
  name: true,
  description: true,
  thumbnail: true,
  isPublished: true,
  orderIndex: true,
  createdAt: true,
  updatedAt: true,
};

const MANAGE_SELECT = {
  ...PUBLIC_SELECT,
  _count: {
    select: { decks: true },
  },
};

const MAX_LIMIT = 100;

@Injectable()
export class VocabLibraryService {
  constructor(private readonly prismaService: PrismaService) {}

  async findPublished(page?: number, limit?: number) {
    const take = Math.min(limit || 10, MAX_LIMIT);
    const skip = page ? (page - 1) * take : 0;
    const where = { isPublished: true };

    const [libraries, total] = await Promise.all([
      this.prismaService.vocabLibrary.findMany({
        where,
        skip,
        take,
        select: PUBLIC_SELECT,
        orderBy: { orderIndex: 'asc' },
      }),
      this.prismaService.vocabLibrary.count({ where }),
    ]);

    return {
      data: libraries,
      meta: {
        total,
        page: page || 1,
        limit: take,
        totalPages: Math.ceil(total / take),
      },
    };
  }

  async findAllManage(page?: number, limit?: number) {
    const take = Math.min(limit || 10, MAX_LIMIT);
    const skip = page ? (page - 1) * take : 0;

    const [libraries, total] = await Promise.all([
      this.prismaService.vocabLibrary.findMany({
        skip,
        take,
        select: MANAGE_SELECT,
        orderBy: { orderIndex: 'asc' },
      }),
      this.prismaService.vocabLibrary.count(),
    ]);

    return {
      data: libraries,
      meta: {
        total,
        page: page || 1,
        limit: take,
        totalPages: Math.ceil(total / take),
      },
    };
  }

  async findOnePublished(id: string) {
    const library = await this.prismaService.vocabLibrary.findUnique({
      where: { id },
      select: PUBLIC_SELECT,
    });

    // Same 404 whether the id doesn't exist or the library is an unpublished
    // draft, so anonymous callers can't probe for draft ids.
    if (!library || !library.isPublished) {
      throw new NotFoundException(`Vocabulary library with ID ${id} not found`);
    }

    return library;
  }

  async create(dto: CreateVocabLibraryDto) {
    const maxOrderIndex = await this.prismaService.vocabLibrary.aggregate({
      _max: { orderIndex: true },
    });
    const orderIndex = (maxOrderIndex._max.orderIndex ?? -1) + 1;

    // Construct the Prisma payload explicitly rather than spreading the DTO —
    // the global ValidationPipe has no whitelist, so extra properties could
    // otherwise reach the database. Libraries always start as unpublished
    // drafts at the end of the shelf ordering; neither is settable here.
    return this.prismaService.vocabLibrary.create({
      data: {
        name: dto.name,
        description: dto.description,
        thumbnail: dto.thumbnail,
        orderIndex,
      },
      select: PUBLIC_SELECT,
    });
  }

  async update(id: string, dto: UpdateVocabLibraryDto) {
    await this.findOneOrThrow(id);

    // Same reasoning as create(): only these three fields are ever writable
    // through this endpoint. isPublished/orderIndex are intentionally
    // excluded — isPublished can only change via publish()/unpublish(), and
    // orderIndex has no reorder endpoint yet.
    return this.prismaService.vocabLibrary.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.thumbnail !== undefined && { thumbnail: dto.thumbnail }),
      },
      select: PUBLIC_SELECT,
    });
  }

  async publish(id: string) {
    await this.findOneOrThrow(id);

    return this.prismaService.vocabLibrary.update({
      where: { id },
      data: { isPublished: true },
      select: PUBLIC_SELECT,
    });
  }

  async unpublish(id: string) {
    await this.findOneOrThrow(id);

    return this.prismaService.vocabLibrary.update({
      where: { id },
      data: { isPublished: false },
      select: PUBLIC_SELECT,
    });
  }

  // Returns void: the controller responds 204 No Content, so there is no
  // response body to populate.
  async remove(id: string): Promise<void> {
    await this.findOneOrThrow(id);

    const deckCount = await this.prismaService.vocabDeck.count({
      where: { libraryId: id },
    });

    if (deckCount > 0) {
      throw new BadRequestException(
        'Cannot delete library with existing decks. Remove decks first.',
      );
    }

    try {
      await this.prismaService.vocabLibrary.delete({ where: { id } });
    } catch (error) {
      // Backstop for the race between the count check above and this delete
      // (e.g. a deck created concurrently) — Postgres FK violation.
      if (error.code === 'P2003') {
        throw new BadRequestException(
          'Cannot delete library with existing decks. Remove decks first.',
        );
      }
      throw error;
    }
  }

  private async findOneOrThrow(id: string) {
    const library = await this.prismaService.vocabLibrary.findUnique({
      where: { id },
    });

    if (!library) {
      throw new NotFoundException(`Vocabulary library with ID ${id} not found`);
    }

    return library;
  }
}
