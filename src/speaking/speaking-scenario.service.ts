import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CefrLevel } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSpeakingScenarioDto, UpdateSpeakingScenarioDto } from './dto';
import {
  ManageSpeakingScenarioDto,
  SpeakingScenarioCardDto,
  SpeakingScenarioDetailDto,
} from './speaking.types';

// Speaking Partner — scenario (topic card) authoring + the two student reads
// that are scenario-shaped. Mirrors listening-category.service.ts's
// structure: a container with a kill switch (unpublishing a scenario
// removes every exercise underneath it from the student surface at once,
// because the visibility predicate reads both levels — speaking-visibility.ts).

@Injectable()
export class SpeakingScenarioService {
  constructor(private readonly prisma: PrismaService) {}

  // --- student reads (READ-ONLY, always) --------------------------------

  /**
   * GET /speaking/scenarios.
   *
   * Only scenarios that actually have something visible underneath —
   * a published scenario holding nothing but draft exercises is omitted
   * rather than shown as a dead-end card with `(0)`, same rule
   * ListeningContentService.findCatalog applies to its own category chips.
   */
  async findPublishedCatalog(): Promise<SpeakingScenarioCardDto[]> {
    const scenarios = await this.prisma.speakingScenario.findMany({
      where: { isPublished: true, exercises: { some: { isPublished: true } } },
      orderBy: [{ orderIndex: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        nameVi: true,
        description: true,
        descriptionVi: true,
        level: true,
        orderIndex: true,
        isFreeTalk: true,
        _count: { select: { exercises: { where: { isPublished: true } } } },
      },
    });

    return scenarios.map((scenario) => ({
      id: scenario.id,
      name: scenario.name,
      nameVi: scenario.nameVi,
      description: scenario.description,
      descriptionVi: scenario.descriptionVi,
      level: scenario.level,
      orderIndex: scenario.orderIndex,
      isFreeTalk: scenario.isFreeTalk,
      exerciseCount: scenario._count.exercises,
    }));
  }

  /**
   * GET /speaking/scenarios/:id.
   *
   * The 404 is identical for a missing id and a draft scenario. Exercises
   * are built into SpeakingExerciseStudentView explicitly, field by field —
   * never a bare `include: { exercises: true }`, which would leak `aiRole`/
   * `conversationGoal` straight to the browser. See speaking.types.ts.
   */
  async findPublishedDetail(scenarioId: string): Promise<SpeakingScenarioDetailDto> {
    const scenario = await this.prisma.speakingScenario.findFirst({
      where: { id: scenarioId, isPublished: true },
      select: {
        id: true,
        name: true,
        nameVi: true,
        description: true,
        descriptionVi: true,
        level: true,
        isFreeTalk: true,
        exercises: {
          where: { isPublished: true },
          orderBy: { orderIndex: 'asc' },
          select: {
            id: true,
            title: true,
            titleVi: true,
            description: true,
            descriptionVi: true,
            level: true,
            openingLine: true,
          },
        },
      },
    });

    if (!scenario) {
      throw new NotFoundException(`Speaking scenario with ID ${scenarioId} not found`);
    }

    return {
      id: scenario.id,
      name: scenario.name,
      nameVi: scenario.nameVi,
      description: scenario.description,
      descriptionVi: scenario.descriptionVi,
      level: scenario.level,
      isFreeTalk: scenario.isFreeTalk,
      exercises: scenario.exercises.map((exercise) => ({
        id: exercise.id,
        title: exercise.title,
        titleVi: exercise.titleVi,
        description: exercise.description,
        descriptionVi: exercise.descriptionVi,
        level: exercise.level,
        openingLine: exercise.openingLine,
      })),
    };
  }

  // --- admin (manage) ----------------------------------------------------

  async findAllManage(): Promise<ManageSpeakingScenarioDto[]> {
    const scenarios = await this.prisma.speakingScenario.findMany({
      orderBy: [{ orderIndex: 'asc' }, { name: 'asc' }],
      select: MANAGE_SELECT,
    });

    return scenarios.map(toManageScenario);
  }

  async create(dto: CreateSpeakingScenarioDto): Promise<ManageSpeakingScenarioDto> {
    // Explicit field construction, never a DTO spread — the global
    // ValidationPipe is bare (no `whitelist`), so an unknown `isPublished`
    // in the body survives onto req.body; this is what stops it reaching a
    // column, not the pipe.
    const orderIndex = dto.orderIndex ?? (await this.nextOrderIndex());

    const scenario = await this.prisma.speakingScenario.create({
      data: {
        name: dto.name.trim(),
        nameVi: dto.nameVi.trim(),
        description: dto.description?.trim(),
        descriptionVi: dto.descriptionVi?.trim(),
        level: dto.level,
        orderIndex,
        isFreeTalk: dto.isFreeTalk ?? false,
      },
      select: MANAGE_SELECT,
    });

    return toManageScenario(scenario);
  }

  async update(id: string, dto: UpdateSpeakingScenarioDto): Promise<ManageSpeakingScenarioDto> {
    await this.findOneOrThrow(id);

    const scenario = await this.prisma.speakingScenario.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.nameVi !== undefined && { nameVi: dto.nameVi.trim() }),
        ...(dto.description !== undefined && { description: dto.description.trim() }),
        ...(dto.descriptionVi !== undefined && { descriptionVi: dto.descriptionVi.trim() }),
        ...(dto.level !== undefined && { level: dto.level }),
        ...(dto.orderIndex !== undefined && { orderIndex: dto.orderIndex }),
        ...(dto.isFreeTalk !== undefined && { isFreeTalk: dto.isFreeTalk }),
      },
      select: MANAGE_SELECT,
    });

    return toManageScenario(scenario);
  }

  async publish(id: string): Promise<ManageSpeakingScenarioDto> {
    return this.setPublished(id, true);
  }

  /**
   * Unpublish. ALLOWED EVEN WHEN PUBLISHED EXERCISES SIT UNDERNEATH — that
   * is the point: it is the one action that takes a whole topic off the
   * student surface without touching each exercise. Exercises keep their
   * own `isPublished` untouched, so re-publishing the scenario restores
   * exactly the previous state rather than a flattened one.
   */
  async unpublish(id: string): Promise<ManageSpeakingScenarioDto> {
    return this.setPublished(id, false);
  }

  /**
   * Delete. Count first, then delete, with the FK violation as a backstop
   * for the race between the two — same shape as
   * ListeningCategoryService.remove. The relation is Restrict, so Postgres
   * refuses it even if this check is somehow skipped.
   */
  async remove(id: string): Promise<void> {
    await this.findOneOrThrow(id);

    const exerciseCount = await this.prisma.speakingExercise.count({
      where: { scenarioId: id },
    });

    if (exerciseCount > 0) {
      throw new BadRequestException(
        'Cannot delete a scenario that still has exercises. Move or delete the exercises first.',
      );
    }

    try {
      await this.prisma.speakingScenario.delete({ where: { id } });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2003') {
        throw new BadRequestException(
          'Cannot delete a scenario that still has exercises. Move or delete the exercises first.',
        );
      }
      throw error;
    }
  }

  private async setPublished(
    id: string,
    isPublished: boolean,
  ): Promise<ManageSpeakingScenarioDto> {
    await this.findOneOrThrow(id);

    const scenario = await this.prisma.speakingScenario.update({
      where: { id },
      data: { isPublished },
      select: MANAGE_SELECT,
    });

    return toManageScenario(scenario);
  }

  private async nextOrderIndex(): Promise<number> {
    const highest = await this.prisma.speakingScenario.aggregate({
      _max: { orderIndex: true },
    });
    return (highest._max.orderIndex ?? -1) + 1;
  }

  private async findOneOrThrow(id: string) {
    const scenario = await this.prisma.speakingScenario.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!scenario) {
      throw new NotFoundException(`Speaking scenario with ID ${id} not found`);
    }

    return scenario;
  }
}

const MANAGE_SELECT = {
  id: true,
  name: true,
  nameVi: true,
  description: true,
  descriptionVi: true,
  level: true,
  orderIndex: true,
  isPublished: true,
  isFreeTalk: true,
  _count: { select: { exercises: true } },
} as const;

const toManageScenario = (row: {
  id: string;
  name: string;
  nameVi: string;
  description: string | null;
  descriptionVi: string | null;
  level: CefrLevel | null;
  orderIndex: number;
  isPublished: boolean;
  isFreeTalk: boolean;
  _count: { exercises: number };
}): ManageSpeakingScenarioDto => ({
  id: row.id,
  name: row.name,
  nameVi: row.nameVi,
  description: row.description,
  descriptionVi: row.descriptionVi,
  level: row.level,
  orderIndex: row.orderIndex,
  isPublished: row.isPublished,
  isFreeTalk: row.isFreeTalk,
  exerciseCount: row._count.exercises,
});
