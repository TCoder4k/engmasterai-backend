import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateListeningContentDto,
  QueryListeningCatalogDto,
  QueryListeningManageDto,
  UpdateListeningContentDto,
  UpsertListeningSegmentsDto,
} from './dto';
import { visibleContentWhere } from './listening-visibility';
import {
  validateContentForPublish,
  validateSegmentDocument,
} from './segment-validation';
import { normalizeReferenceText } from './text-normalization';
import {
  ListeningCatalogResponseDto,
  ListeningContentDetailDto,
  ManageListeningContentDto,
  ManageListeningContentSummaryDto,
} from './listening.types';

const MAX_LIMIT = 100;

/**
 * Reordering offset.
 *
 * `@@unique([contentId, orderIndex])` is checked per statement — Prisma does
 * not create DEFERRABLE constraints — so swapping two sentences by writing
 * their new positions directly collides the moment the first UPDATE lands on
 * an index the second one still holds. Every surviving row is therefore parked
 * above this offset before any final position is written. Larger than the
 * 500-segment cap in the DTO by three orders of magnitude, so the parked range
 * and the final range can never meet.
 */
const REORDER_OFFSET = 1_000_000;

/** Shared by the Phase 4A guard and the FK backstop, so they cannot diverge. */
const LEARNER_DATA_BLOCKS_DELETE =
  'Cannot delete listening content that students have already practised. Unpublish it instead.';

@Injectable()
export class ListeningContentService {
  constructor(private readonly prisma: PrismaService) {}

  // --- student reads (READ-ONLY, always) ------------------------------------

  /**
   * GET /listening/catalog.
   *
   * THREE QUERIES, FIXED — page of cards, total, and the category chips. The
   * chip counts come from the database rather than from the page just fetched,
   * because a page of 12 cannot know how many recordings the other pages hold,
   * and a chip that says `(3)` next to a filter yielding 40 results is the kind
   * of invented number this codebase has spent three sprints removing.
   */
  async findCatalog(
    query: QueryListeningCatalogDto,
  ): Promise<ListeningCatalogResponseDto> {
    const take = Math.min(query.limit || 12, MAX_LIMIT);
    const skip = query.page ? (query.page - 1) * take : 0;

    const where: Prisma.ListeningContentWhereInput = {
      ...visibleContentWhere,
      ...(query.categoryId && { categoryId: query.categoryId }),
      ...(query.level && { level: query.level }),
      ...(query.mode && { supportedModes: { has: query.mode } }),
      ...(query.q && { title: { contains: query.q, mode: 'insensitive' } }),
    };

    const [contents, total, categories] = await Promise.all([
      this.prisma.listeningContent.findMany({
        where,
        skip,
        take,
        orderBy: [{ orderIndex: 'asc' }, { createdAt: 'desc' }],
        select: CARD_SELECT,
      }),
      this.prisma.listeningContent.count({ where }),
      // Only categories that actually have something visible. A published
      // category holding nothing but drafts is omitted rather than shown as
      // `(0)`: an empty section is a dead end, and it would also quietly
      // confirm that unpublished content exists.
      this.prisma.listeningCategory.findMany({
        where: {
          isPublished: true,
          contents: { some: { isPublished: true } },
        },
        orderBy: [{ orderIndex: 'asc' }, { name: 'asc' }],
        select: {
          id: true,
          name: true,
          nameVi: true,
          orderIndex: true,
          _count: { select: { contents: { where: { isPublished: true } } } },
        },
      }),
    ]);

    return {
      data: contents.map((content) => ({
        id: content.id,
        title: content.title,
        description: content.description,
        level: content.level,
        thumbnailUrl: content.thumbnailUrl,
        durationMs: content.durationMs,
        segmentCount: content._count.segments,
        supportedModes: content.supportedModes,
        sourceName: content.sourceName,
        category: content.category,
      })),
      meta: {
        total,
        page: query.page || 1,
        limit: take,
        totalPages: Math.ceil(total / take),
      },
      categories: categories.map((category) => ({
        id: category.id,
        name: category.name,
        nameVi: category.nameVi,
        orderIndex: category.orderIndex,
        contentCount: category._count.contents,
      })),
    };
  }

  /**
   * GET /listening/contents/:contentId.
   *
   * The 404 is identical for a missing id, a draft recording and a draft
   * category — see listening-visibility.ts. The predicate is applied here as a
   * `where` rather than through assertContentVisible so the check and the read
   * are one query instead of two; it is the same fragment, exported from that
   * file precisely so this cannot drift from it.
   */
  async findOneVisible(contentId: string): Promise<ListeningContentDetailDto> {
    const content = await this.prisma.listeningContent.findFirst({
      where: { id: contentId, ...visibleContentWhere },
      select: DETAIL_SELECT,
    });

    if (!content) {
      throw new NotFoundException(
        `Listening content with ID ${contentId} not found`,
      );
    }

    return {
      id: content.id,
      title: content.title,
      description: content.description,
      level: content.level,
      thumbnailUrl: content.thumbnailUrl,
      sourceName: content.sourceName,
      sourceUrl: content.sourceUrl,
      mediaType: content.mediaType,
      mediaProvider: content.mediaProvider,
      mediaUrl: content.mediaUrl,
      externalMediaId: content.externalMediaId,
      durationMs: content.durationMs,
      supportedModes: content.supportedModes,
      category: content.category,
      // Constructed field by field rather than passed through, so
      // `normalizedText` and `notes` cannot arrive here by a widened select.
      segments: content.segments.map((segment) => ({
        id: segment.id,
        orderIndex: segment.orderIndex,
        text: segment.text,
        ipa: segment.ipa,
        translationVi: segment.translationVi,
        startTimeMs: segment.startTimeMs,
        endTimeMs: segment.endTimeMs,
      })),
    };
  }

  // --- admin ----------------------------------------------------------------

  async findAllManage(query: QueryListeningManageDto): Promise<{
    data: ManageListeningContentSummaryDto[];
    meta: { total: number; page: number; limit: number; totalPages: number };
  }> {
    const take = Math.min(query.limit || 20, MAX_LIMIT);
    const skip = query.page ? (query.page - 1) * take : 0;
    const where: Prisma.ListeningContentWhereInput = {
      ...(query.categoryId && { categoryId: query.categoryId }),
    };

    const [contents, total] = await Promise.all([
      this.prisma.listeningContent.findMany({
        where,
        skip,
        take,
        orderBy: [{ updatedAt: 'desc' }],
        select: MANAGE_SUMMARY_SELECT,
      }),
      this.prisma.listeningContent.count({ where }),
    ]);

    return {
      data: contents.map((content) => ({
        id: content.id,
        title: content.title,
        level: content.level,
        mediaProvider: content.mediaProvider,
        mediaType: content.mediaType,
        supportedModes: content.supportedModes,
        orderIndex: content.orderIndex,
        isPublished: content.isPublished,
        segmentCount: content._count.segments,
        category: content.category,
        updatedAt: content.updatedAt,
      })),
      meta: {
        total,
        page: query.page || 1,
        limit: take,
        totalPages: Math.ceil(total / take),
      },
    };
  }

  async findOneManage(id: string): Promise<ManageListeningContentDto> {
    const content = await this.prisma.listeningContent.findUnique({
      where: { id },
      select: MANAGE_DETAIL_SELECT,
    });

    if (!content) {
      throw new NotFoundException(`Listening content with ID ${id} not found`);
    }

    return toManageContent(content);
  }

  async create(
    dto: CreateListeningContentDto,
  ): Promise<ManageListeningContentDto> {
    await this.assertCategoryExists(dto.categoryId);

    const orderIndex =
      dto.orderIndex ?? (await this.nextContentOrderIndex(dto.categoryId));

    // Explicit construction. `isPublished` is not writable here by design —
    // publication runs through publish(), where the validation lives.
    const created = await this.prisma.listeningContent.create({
      data: {
        categoryId: dto.categoryId,
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        level: dto.level,
        thumbnailUrl: dto.thumbnailUrl?.trim() || null,
        sourceName: dto.sourceName?.trim() || null,
        sourceUrl: dto.sourceUrl?.trim() || null,
        mediaType: dto.mediaType,
        mediaProvider: dto.mediaProvider,
        mediaUrl: dto.mediaUrl.trim(),
        externalMediaId: dto.externalMediaId?.trim() || null,
        durationMs: dto.durationMs ?? null,
        supportedModes: dto.supportedModes,
        orderIndex,
      },
      select: MANAGE_DETAIL_SELECT,
    });

    return toManageContent(created);
  }

  async update(
    id: string,
    dto: UpdateListeningContentDto,
  ): Promise<ManageListeningContentDto> {
    await this.findOneOrThrow(id);
    if (dto.categoryId !== undefined) {
      // Moving a recording between categories is allowed at any time,
      // including once students have progress on it: progress hangs off the
      // content, so a move changes where it is listed and nothing else.
      await this.assertCategoryExists(dto.categoryId);
    }

    const updated = await this.prisma.listeningContent.update({
      where: { id },
      data: {
        ...(dto.categoryId !== undefined && { categoryId: dto.categoryId }),
        ...(dto.title !== undefined && { title: dto.title.trim() }),
        ...(dto.description !== undefined && {
          description: dto.description.trim() || null,
        }),
        ...(dto.level !== undefined && { level: dto.level }),
        ...(dto.thumbnailUrl !== undefined && {
          thumbnailUrl: dto.thumbnailUrl.trim() || null,
        }),
        ...(dto.sourceName !== undefined && {
          sourceName: dto.sourceName.trim() || null,
        }),
        ...(dto.sourceUrl !== undefined && {
          sourceUrl: dto.sourceUrl.trim() || null,
        }),
        ...(dto.mediaType !== undefined && { mediaType: dto.mediaType }),
        ...(dto.mediaProvider !== undefined && {
          mediaProvider: dto.mediaProvider,
        }),
        ...(dto.mediaUrl !== undefined && { mediaUrl: dto.mediaUrl.trim() }),
        ...(dto.externalMediaId !== undefined && {
          externalMediaId: dto.externalMediaId.trim() || null,
        }),
        ...(dto.durationMs !== undefined && { durationMs: dto.durationMs }),
        ...(dto.supportedModes !== undefined && {
          supportedModes: dto.supportedModes,
        }),
        ...(dto.orderIndex !== undefined && { orderIndex: dto.orderIndex }),
      },
      select: MANAGE_DETAIL_SELECT,
    });

    return toManageContent(updated);
  }

  /**
   * PUT /listening/manage/contents/:id/segments — whole-document upsert.
   *
   * Ids that survive are UPDATED IN PLACE. This is the single most important
   * property of the method: from Phase 4A a segment carries a student's
   * progress and their attempt history, both cascading from it, so a
   * delete-all + create-all rewrite would destroy that history every time an
   * author fixed a typo three sentences away.
   *
   * EDITING A SEGMENT THAT ALREADY HAS ATTEMPTS IS PERMITTED (approved
   * decision). The alternative — freezing scoring-relevant fields once anyone
   * has practised — makes a live recording unfixable, which is the far more
   * common real need. Phase 4B closes the resulting ambiguity by storing
   * `referenceTextSnapshot` on each attempt, so a past result always records
   * the sentence it was actually graded against. THAT COLUMN IS NOT OPTIONAL
   * FOR PHASE 4B; this policy is what makes it load-bearing.
   */
  async upsertSegments(
    contentId: string,
    dto: UpsertListeningSegmentsDto,
  ): Promise<ManageListeningContentDto> {
    await this.findOneOrThrow(contentId);

    const structuralError = validateSegmentDocument(dto.segments);
    if (structuralError) {
      throw new BadRequestException(structuralError);
    }

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.listeningSegment.findMany({
        where: { contentId },
        select: { id: true },
      });
      const existingIds = new Set(existing.map((row) => row.id));
      const incomingIds = new Set(
        dto.segments
          .map((segment) => segment.id)
          .filter((id): id is string => Boolean(id) && existingIds.has(id!)),
      );

      const idsToDelete = [...existingIds].filter((id) => !incomingIds.has(id));
      if (idsToDelete.length > 0) {
        await tx.listeningSegment.deleteMany({
          where: { id: { in: idsToDelete } },
        });
      }

      // Park every survivor above the final range before writing any final
      // position — see REORDER_OFFSET. Without this, moving sentence 5 to
      // position 2 fails on the unique constraint rather than reordering.
      if (incomingIds.size > 0) {
        await tx.listeningSegment.updateMany({
          where: { contentId },
          data: { orderIndex: { increment: REORDER_OFFSET } },
        });
      }

      for (const [index, segment] of dto.segments.entries()) {
        const data = {
          text: segment.text.trim(),
          normalizedText: normalizeReferenceText(segment.text),
          ipa: segment.ipa?.trim() || null,
          translationVi: segment.translationVi?.trim() || null,
          notes: segment.notes?.trim() || null,
          startTimeMs: segment.startTimeMs,
          endTimeMs: segment.endTimeMs,
          orderIndex: index,
        };

        if (segment.id && incomingIds.has(segment.id)) {
          await tx.listeningSegment.update({
            where: { id: segment.id },
            data,
          });
        } else {
          // An id the client sent that does not belong to this content is
          // treated as a NEW segment rather than an error: the only way to
          // produce one is a stale editor tab, and creating the sentence the
          // author typed is friendlier than refusing the whole save. It can
          // never touch another content's row, because the branch above only
          // matches ids fetched from THIS contentId.
          await tx.listeningSegment.create({ data: { ...data, contentId } });
        }
      }
    });

    return this.findOneManage(contentId);
  }

  /**
   * PATCH /listening/manage/contents/:id/publish.
   *
   * Everything the student surface depends on is checked here, in one place,
   * against a pure function (segment-validation.ts) that returns the exact
   * message the admin will read. A 400 naming the first real problem is worth
   * more than a generic refusal.
   */
  async publish(id: string): Promise<ManageListeningContentDto> {
    const content = await this.prisma.listeningContent.findUnique({
      where: { id },
      select: {
        supportedModes: true,
        mediaType: true,
        mediaProvider: true,
        mediaUrl: true,
        sourceName: true,
        sourceUrl: true,
        durationMs: true,
        category: { select: { isPublished: true } },
        segments: {
          orderBy: { orderIndex: 'asc' },
          select: { text: true, startTimeMs: true, endTimeMs: true },
        },
      },
    });

    if (!content) {
      throw new NotFoundException(`Listening content with ID ${id} not found`);
    }

    const error = validateContentForPublish({
      supportedModes: content.supportedModes,
      mediaType: content.mediaType,
      mediaProvider: content.mediaProvider,
      mediaUrl: content.mediaUrl,
      sourceName: content.sourceName,
      sourceUrl: content.sourceUrl,
      durationMs: content.durationMs,
      categoryIsPublished: content.category.isPublished,
      segments: content.segments,
    });

    if (error) {
      throw new BadRequestException(error);
    }

    const updated = await this.prisma.listeningContent.update({
      where: { id },
      data: { isPublished: true },
      select: MANAGE_DETAIL_SELECT,
    });

    return toManageContent(updated);
  }

  async unpublish(id: string): Promise<ManageListeningContentDto> {
    await this.findOneOrThrow(id);

    const updated = await this.prisma.listeningContent.update({
      where: { id },
      data: { isPublished: false },
      select: MANAGE_DETAIL_SELECT,
    });

    return toManageContent(updated);
  }

  async remove(id: string): Promise<void> {
    await this.findOneOrThrow(id);
    this.assertNoLearnerData(id);

    try {
      // Segments cascade. Safe precisely because deletion is gated above — a
      // recording nobody has practised carries nothing worth preserving.
      await this.prisma.listeningContent.delete({ where: { id } });
    } catch (error) {
      // The backstop, live from day one even though nothing can trigger it
      // yet. Written now rather than with the check it guards, because the
      // relation that will raise it (ListeningModeProgress.content, Restrict)
      // arrives in a sprint that will be focused on progress, not on
      // remembering that an unrelated admin route needs a nicer error. Same
      // shape as CourseService.remove.
      if ((error as { code?: string }).code === 'P2003') {
        throw new BadRequestException(LEARNER_DATA_BLOCKS_DELETE);
      }
      throw error;
    }
  }

  /**
   * The learner-data gate. THE SEAM PHASE 4A FILLS IN.
   *
   * Sprint 11 ships no progress and no attempt models, so there is nothing to
   * count and this is deliberately a no-op — a synchronous one, so nothing
   * about the call site pretends a query is happening.
   *
   * It exists as a named method rather than as a comment because the rule it
   * will enforce is already decided and already encoded in the schema:
   * `ListeningModeProgress.content` will be Restrict, so once that model lands
   * the database refuses the delete whether or not anyone remembers this.
   *
   * PHASE 4A MUST replace the body with a `listeningModeProgress.count` guard
   * throwing LEARNER_DATA_BLOCKS_DELETE, so the admin reads a sentence
   * explaining the refusal rather than hitting the backstop above.
   */
  private assertNoLearnerData(contentId: string): void {
    void contentId;
  }

  // --- helpers --------------------------------------------------------------

  private async nextContentOrderIndex(categoryId: string): Promise<number> {
    const highest = await this.prisma.listeningContent.aggregate({
      where: { categoryId },
      _max: { orderIndex: true },
    });
    return (highest._max.orderIndex ?? -1) + 1;
  }

  private async assertCategoryExists(categoryId: string): Promise<void> {
    const category = await this.prisma.listeningCategory.findUnique({
      where: { id: categoryId },
      select: { id: true },
    });

    if (!category) {
      throw new BadRequestException(
        `Listening category with ID ${categoryId} not found`,
      );
    }
  }

  private async findOneOrThrow(id: string) {
    const content = await this.prisma.listeningContent.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!content) {
      throw new NotFoundException(`Listening content with ID ${id} not found`);
    }

    return content;
  }
}

// --- selects ----------------------------------------------------------------

const CATEGORY_PUBLIC_SELECT = {
  id: true,
  name: true,
  nameVi: true,
  orderIndex: true,
} as const;

const CARD_SELECT = {
  id: true,
  title: true,
  description: true,
  level: true,
  thumbnailUrl: true,
  durationMs: true,
  supportedModes: true,
  sourceName: true,
  category: { select: CATEGORY_PUBLIC_SELECT },
  _count: { select: { segments: true } },
} as const;

// NOTE the segment select: `normalizedText` and `notes` are absent, and must
// stay absent. The mapper builds the student DTO field by field as a second
// line of defence, but this is the first one.
const DETAIL_SELECT = {
  id: true,
  title: true,
  description: true,
  level: true,
  thumbnailUrl: true,
  sourceName: true,
  sourceUrl: true,
  mediaType: true,
  mediaProvider: true,
  mediaUrl: true,
  externalMediaId: true,
  durationMs: true,
  supportedModes: true,
  category: { select: CATEGORY_PUBLIC_SELECT },
  segments: {
    orderBy: { orderIndex: 'asc' },
    select: {
      id: true,
      orderIndex: true,
      text: true,
      ipa: true,
      translationVi: true,
      startTimeMs: true,
      endTimeMs: true,
    },
  },
} as const satisfies Prisma.ListeningContentSelect;

const MANAGE_CATEGORY_SELECT = {
  ...CATEGORY_PUBLIC_SELECT,
  isPublished: true,
} as const;

const MANAGE_SUMMARY_SELECT = {
  id: true,
  title: true,
  level: true,
  mediaProvider: true,
  mediaType: true,
  supportedModes: true,
  orderIndex: true,
  isPublished: true,
  updatedAt: true,
  category: { select: MANAGE_CATEGORY_SELECT },
  _count: { select: { segments: true } },
} as const;

const MANAGE_DETAIL_SELECT = {
  id: true,
  categoryId: true,
  title: true,
  description: true,
  level: true,
  thumbnailUrl: true,
  sourceName: true,
  sourceUrl: true,
  mediaType: true,
  mediaProvider: true,
  mediaUrl: true,
  externalMediaId: true,
  durationMs: true,
  supportedModes: true,
  orderIndex: true,
  isPublished: true,
  createdAt: true,
  updatedAt: true,
  category: {
    select: {
      ...MANAGE_CATEGORY_SELECT,
      _count: { select: { contents: true } },
    },
  },
  segments: {
    orderBy: { orderIndex: 'asc' },
    select: {
      id: true,
      orderIndex: true,
      text: true,
      ipa: true,
      translationVi: true,
      notes: true,
      startTimeMs: true,
      endTimeMs: true,
    },
  },
  _count: { select: { segments: true } },
} as const satisfies Prisma.ListeningContentSelect;

type ManageContentRow = Prisma.ListeningContentGetPayload<{
  select: typeof MANAGE_DETAIL_SELECT;
}>;

const toManageContent = (
  content: ManageContentRow,
): ManageListeningContentDto => ({
  id: content.id,
  title: content.title,
  description: content.description,
  level: content.level,
  thumbnailUrl: content.thumbnailUrl,
  sourceName: content.sourceName,
  sourceUrl: content.sourceUrl,
  mediaType: content.mediaType,
  mediaProvider: content.mediaProvider,
  mediaUrl: content.mediaUrl,
  externalMediaId: content.externalMediaId,
  durationMs: content.durationMs,
  supportedModes: content.supportedModes,
  orderIndex: content.orderIndex,
  isPublished: content.isPublished,
  categoryId: content.categoryId,
  category: {
    id: content.category.id,
    name: content.category.name,
    nameVi: content.category.nameVi,
    orderIndex: content.category.orderIndex,
    isPublished: content.category.isPublished,
    contentCount: content.category._count.contents,
  },
  segmentCount: content._count.segments,
  segments: content.segments.map((segment) => ({
    id: segment.id,
    orderIndex: segment.orderIndex,
    text: segment.text,
    ipa: segment.ipa,
    translationVi: segment.translationVi,
    notes: segment.notes,
    startTimeMs: segment.startTimeMs,
    endTimeMs: segment.endTimeMs,
  })),
  createdAt: content.createdAt,
  updatedAt: content.updatedAt,
});
