import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateListeningCategoryDto, UpdateListeningCategoryDto } from './dto';
import { ManageListeningCategoryDto } from './listening.types';

// Sprint 11 — admin category management.
//
// A category is a container with a kill switch: unpublishing one removes every
// recording underneath it from the student surface at once, because the
// visibility predicate reads both levels (listening-visibility.ts). That is
// the whole reason it carries `isPublished` rather than being a plain label.

@Injectable()
export class ListeningCategoryService {
  constructor(private readonly prisma: PrismaService) {}

  async findAllManage(): Promise<ManageListeningCategoryDto[]> {
    const categories = await this.prisma.listeningCategory.findMany({
      orderBy: [{ orderIndex: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        nameVi: true,
        orderIndex: true,
        isPublished: true,
        // Counts DRAFTS TOO. This is the admin list; hiding unpublished
        // recordings from the number here would make "cannot delete: 3
        // contents" contradict a row reading "0".
        _count: { select: { contents: true } },
      },
    });

    return categories.map(toManageCategory);
  }

  async create(
    dto: CreateListeningCategoryDto,
  ): Promise<ManageListeningCategoryDto> {
    // Explicit field construction, never a DTO spread. The global
    // ValidationPipe is bare (no `whitelist`), so an unknown `isPublished` in
    // the body survives onto req.body — this is what stops it reaching a
    // column, not the pipe.
    const orderIndex = dto.orderIndex ?? (await this.nextOrderIndex());

    const category = await this.prisma.listeningCategory.create({
      data: {
        name: dto.name.trim(),
        nameVi: dto.nameVi.trim(),
        orderIndex,
      },
      select: MANAGE_SELECT,
    });

    return toManageCategory(category);
  }

  async update(
    id: string,
    dto: UpdateListeningCategoryDto,
  ): Promise<ManageListeningCategoryDto> {
    await this.findOneOrThrow(id);

    const category = await this.prisma.listeningCategory.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.nameVi !== undefined && { nameVi: dto.nameVi.trim() }),
        ...(dto.orderIndex !== undefined && { orderIndex: dto.orderIndex }),
      },
      select: MANAGE_SELECT,
    });

    return toManageCategory(category);
  }

  async publish(id: string): Promise<ManageListeningCategoryDto> {
    return this.setPublished(id, true);
  }

  /**
   * Unpublish.
   *
   * ALLOWED EVEN WHEN PUBLISHED CONTENT SITS UNDERNEATH, and that is the
   * point: it is the one action that takes a whole topic off the student
   * surface without touching each recording. The contents keep their own
   * `isPublished` untouched, so re-publishing the category restores exactly
   * the previous state rather than a flattened one.
   */
  async unpublish(id: string): Promise<ManageListeningCategoryDto> {
    return this.setPublished(id, false);
  }

  /**
   * Delete.
   *
   * Count first, then delete, with the FK violation as a backstop for the race
   * between the two — the same shape (and the same reasoning) as
   * CourseService.remove. The relation is Restrict, so Postgres refuses it
   * even if this check is somehow skipped.
   */
  async remove(id: string): Promise<void> {
    await this.findOneOrThrow(id);

    const contentCount = await this.prisma.listeningContent.count({
      where: { categoryId: id },
    });

    if (contentCount > 0) {
      throw new BadRequestException(
        'Cannot delete a category that still has listening content. Move or delete the content first.',
      );
    }

    try {
      await this.prisma.listeningCategory.delete({ where: { id } });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2003') {
        throw new BadRequestException(
          'Cannot delete a category that still has listening content. Move or delete the content first.',
        );
      }
      throw error;
    }
  }

  private async setPublished(
    id: string,
    isPublished: boolean,
  ): Promise<ManageListeningCategoryDto> {
    await this.findOneOrThrow(id);

    const category = await this.prisma.listeningCategory.update({
      where: { id },
      data: { isPublished },
      select: MANAGE_SELECT,
    });

    return toManageCategory(category);
  }

  private async nextOrderIndex(): Promise<number> {
    const highest = await this.prisma.listeningCategory.aggregate({
      _max: { orderIndex: true },
    });
    return (highest._max.orderIndex ?? -1) + 1;
  }

  private async findOneOrThrow(id: string) {
    const category = await this.prisma.listeningCategory.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!category) {
      throw new NotFoundException(`Listening category with ID ${id} not found`);
    }

    return category;
  }
}

const MANAGE_SELECT = {
  id: true,
  name: true,
  nameVi: true,
  orderIndex: true,
  isPublished: true,
  _count: { select: { contents: true } },
} as const;

const toManageCategory = (row: {
  id: string;
  name: string;
  nameVi: string;
  orderIndex: number;
  isPublished: boolean;
  _count: { contents: number };
}): ManageListeningCategoryDto => ({
  id: row.id,
  name: row.name,
  nameVi: row.nameVi,
  orderIndex: row.orderIndex,
  isPublished: row.isPublished,
  contentCount: row._count.contents,
});
