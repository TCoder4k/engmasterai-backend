import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSpeakingExerciseDto, QuerySpeakingManageDto, UpdateSpeakingExerciseDto } from './dto';
import { ManageSpeakingExerciseDto } from './speaking.types';

const MAX_LIMIT = 100;

/** Everything the admin surface may see — this is never returned on a student route. */
const MANAGE_SELECT = {
  id: true,
  scenarioId: true,
  title: true,
  titleVi: true,
  description: true,
  descriptionVi: true,
  level: true,
  aiRole: true,
  openingLine: true,
  conversationGoal: true,
  targetTurns: true,
  orderIndex: true,
  isPublished: true,
} as const satisfies Prisma.SpeakingExerciseSelect;

// Speaking Partner — exercise authoring, ADMIN only. Mirrors the
// non-segment parts of listening-content.service.ts: no whole-document PUT
// here, unlike Listening's segments — an exercise has no child array to
// upsert, so plain per-row CRUD is enough.

@Injectable()
export class SpeakingExerciseService {
  constructor(private readonly prisma: PrismaService) {}

  async findAllManage(
    query: QuerySpeakingManageDto,
  ): Promise<{ data: ManageSpeakingExerciseDto[]; meta: { total: number; page: number; limit: number; totalPages: number } }> {
    const take = Math.min(query.limit || 20, MAX_LIMIT);
    const skip = query.page ? (query.page - 1) * take : 0;

    const where: Prisma.SpeakingExerciseWhereInput = {
      ...(query.scenarioId && { scenarioId: query.scenarioId }),
    };

    const [exercises, total] = await Promise.all([
      this.prisma.speakingExercise.findMany({
        where,
        skip,
        take,
        orderBy: [{ scenarioId: 'asc' }, { orderIndex: 'asc' }],
        select: MANAGE_SELECT,
      }),
      this.prisma.speakingExercise.count({ where }),
    ]);

    return {
      data: exercises,
      meta: { total, page: query.page || 1, limit: take, totalPages: Math.ceil(total / take) },
    };
  }

  async findOneManage(id: string): Promise<ManageSpeakingExerciseDto> {
    return this.findOneOrThrow(id);
  }

  async create(dto: CreateSpeakingExerciseDto): Promise<ManageSpeakingExerciseDto> {
    const scenario = await this.prisma.speakingScenario.findUnique({
      where: { id: dto.scenarioId },
      select: { id: true },
    });
    if (!scenario) {
      throw new NotFoundException(`Speaking scenario with ID ${dto.scenarioId} not found`);
    }

    const orderIndex = dto.orderIndex ?? (await this.nextOrderIndex(dto.scenarioId));

    // Explicit field construction, never a DTO spread — same discipline as
    // every other admin-authored model in this codebase.
    return this.prisma.speakingExercise.create({
      data: {
        scenarioId: dto.scenarioId,
        title: dto.title.trim(),
        titleVi: dto.titleVi.trim(),
        description: dto.description.trim(),
        descriptionVi: dto.descriptionVi.trim(),
        level: dto.level,
        aiRole: dto.aiRole.trim(),
        openingLine: dto.openingLine.trim(),
        conversationGoal: dto.conversationGoal?.trim(),
        targetTurns: dto.targetTurns ?? 5,
        orderIndex,
      },
      select: MANAGE_SELECT,
    });
  }

  async update(id: string, dto: UpdateSpeakingExerciseDto): Promise<ManageSpeakingExerciseDto> {
    await this.findOneOrThrow(id);

    if (dto.scenarioId !== undefined) {
      const scenario = await this.prisma.speakingScenario.findUnique({
        where: { id: dto.scenarioId },
        select: { id: true },
      });
      if (!scenario) {
        throw new NotFoundException(`Speaking scenario with ID ${dto.scenarioId} not found`);
      }
    }

    return this.prisma.speakingExercise.update({
      where: { id },
      data: {
        ...(dto.scenarioId !== undefined && { scenarioId: dto.scenarioId }),
        ...(dto.title !== undefined && { title: dto.title.trim() }),
        ...(dto.titleVi !== undefined && { titleVi: dto.titleVi.trim() }),
        ...(dto.description !== undefined && { description: dto.description.trim() }),
        ...(dto.descriptionVi !== undefined && { descriptionVi: dto.descriptionVi.trim() }),
        ...(dto.level !== undefined && { level: dto.level }),
        ...(dto.aiRole !== undefined && { aiRole: dto.aiRole.trim() }),
        ...(dto.openingLine !== undefined && { openingLine: dto.openingLine.trim() }),
        ...(dto.conversationGoal !== undefined && { conversationGoal: dto.conversationGoal.trim() }),
        ...(dto.targetTurns !== undefined && { targetTurns: dto.targetTurns }),
        ...(dto.orderIndex !== undefined && { orderIndex: dto.orderIndex }),
      },
      select: MANAGE_SELECT,
    });
  }

  async publish(id: string): Promise<ManageSpeakingExerciseDto> {
    return this.setPublished(id, true);
  }

  async unpublish(id: string): Promise<ManageSpeakingExerciseDto> {
    return this.setPublished(id, false);
  }

  /**
   * Delete. Count attempts first, then delete, with the FK violation as a
   * backstop for the race between the two — the relation is Restrict, so an
   * exercise real students have practised cannot be removed, only
   * unpublished.
   */
  async remove(id: string): Promise<void> {
    await this.findOneOrThrow(id);

    const attemptCount = await this.prisma.speakingAttempt.count({
      where: { exerciseId: id },
    });

    if (attemptCount > 0) {
      throw new BadRequestException(
        'Cannot delete an exercise that students have already practised. Unpublish it instead.',
      );
    }

    try {
      await this.prisma.speakingExercise.delete({ where: { id } });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2003') {
        throw new BadRequestException(
          'Cannot delete an exercise that students have already practised. Unpublish it instead.',
        );
      }
      throw error;
    }
  }

  private async setPublished(id: string, isPublished: boolean): Promise<ManageSpeakingExerciseDto> {
    await this.findOneOrThrow(id);

    return this.prisma.speakingExercise.update({
      where: { id },
      data: { isPublished },
      select: MANAGE_SELECT,
    });
  }

  private async nextOrderIndex(scenarioId: string): Promise<number> {
    const highest = await this.prisma.speakingExercise.aggregate({
      where: { scenarioId },
      _max: { orderIndex: true },
    });
    return (highest._max.orderIndex ?? -1) + 1;
  }

  private async findOneOrThrow(id: string): Promise<ManageSpeakingExerciseDto> {
    const exercise = await this.prisma.speakingExercise.findUnique({
      where: { id },
      select: MANAGE_SELECT,
    });

    if (!exercise) {
      throw new NotFoundException(`Speaking exercise with ID ${id} not found`);
    }

    return exercise;
  }
}
