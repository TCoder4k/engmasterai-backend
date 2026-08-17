import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CourseType, Prisma, QuestionDifficulty } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { validateQuestionContent } from '../lesson/quiz/grade-question';
import { CreatePlacementQuestionDto } from './dto/create-placement-question.dto';
import { UpdatePlacementQuestionDto } from './dto/update-placement-question.dto';
import { QueryPlacementQuestionDto } from './dto/query-placement-question.dto';
import { DIFFICULTY_REQUIREMENTS, PLACEMENT_SECTIONS } from './placement.constants';

// Admin select — everything, including correctAnswer/explanation. There is
// deliberately no student-facing select in this file: the STUDENT-safe shape
// (never correctAnswer/explanation, Invariant 9's exact discipline) is built
// where questions are actually served to a test-taker, in PlacementService.
const MANAGE_PLACEMENT_QUESTION_SELECT = {
  id: true,
  section: true,
  type: true,
  difficulty: true,
  content: true,
  options: true,
  correctAnswer: true,
  explanation: true,
  audioUrl: true,
  transcript: true,
  imageUrl: true,
  isPublished: true,
  createdAt: true,
  updatedAt: true,
};

const MAX_LIMIT = 100;

@Injectable()
export class PlacementQuestionService {
  constructor(private readonly prisma: PrismaService) {}

  async findAllManage(query: QueryPlacementQuestionDto) {
    const take = Math.min(query.limit || 20, MAX_LIMIT);
    const skip = query.page ? (query.page - 1) * take : 0;
    const where: Prisma.PlacementQuestionWhereInput = {
      ...(query.section && { section: query.section }),
      ...(query.difficulty && { difficulty: query.difficulty }),
    };

    const [data, total] = await Promise.all([
      this.prisma.placementQuestion.findMany({
        where,
        skip,
        take,
        select: MANAGE_PLACEMENT_QUESTION_SELECT,
        orderBy: [
          { section: 'asc' },
          { difficulty: 'asc' },
          { createdAt: 'desc' },
        ],
      }),
      this.prisma.placementQuestion.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page: query.page || 1,
        limit: take,
        totalPages: Math.ceil(total / take),
      },
    };
  }

  // Admin readiness report — one groupBy, not one query per bucket. Reports
  // exactly the shape POST /placement/start needs to guarantee before it can
  // ever sample a full 12-question test (its PLACEMENT_BANK_INCOMPLETE guard
  // reuses this same bucket math, not a copy of it).
  async getCoverage() {
    const grouped = await this.prisma.placementQuestion.groupBy({
      by: ['section', 'difficulty'],
      where: { isPublished: true },
      _count: { _all: true },
    });

    const countFor = (section: CourseType, difficulty: QuestionDifficulty) =>
      grouped.find((g) => g.section === section && g.difficulty === difficulty)
        ?._count._all ?? 0;

    const buckets = PLACEMENT_SECTIONS.flatMap((section) =>
      (Object.keys(DIFFICULTY_REQUIREMENTS) as QuestionDifficulty[]).map(
        (difficulty) => {
          const required = DIFFICULTY_REQUIREMENTS[difficulty];
          const available = countFor(section, difficulty);
          return {
            section,
            difficulty,
            required,
            available,
            sufficient: available >= required,
          };
        },
      ),
    );

    return { buckets, ready: buckets.every((b) => b.sufficient) };
  }

  async create(dto: CreatePlacementQuestionDto) {
    const error = validateQuestionContent({
      type: dto.type,
      options: dto.options ?? null,
      correctAnswer: dto.correctAnswer,
    });
    if (error) throw new BadRequestException(error);

    // Explicit field construction — never spread the DTO. ValidationPipe is
    // bare (no whitelist/forbidNonWhitelisted), so this is the only thing
    // standing between a request body and an unintended column write.
    return this.prisma.placementQuestion.create({
      data: {
        section: dto.section,
        type: dto.type,
        difficulty: dto.difficulty,
        content: dto.content,
        options: dto.options as unknown as Prisma.InputJsonValue,
        correctAnswer: dto.correctAnswer as Prisma.InputJsonValue,
        explanation: dto.explanation,
        audioUrl: dto.audioUrl,
        transcript: dto.transcript,
        imageUrl: dto.imageUrl,
      },
      select: MANAGE_PLACEMENT_QUESTION_SELECT,
    });
  }

  async update(id: string, dto: UpdatePlacementQuestionDto) {
    const existing = await this.findOneOrThrow(id);

    // Validate against the RESOLVED shape (existing values merged with
    // whatever this patch touches) — correctAnswer's valid shape depends on
    // type, and a patch may change only one of the two.
    const resolvedType = dto.type ?? existing.type;
    const resolvedOptions =
      dto.options !== undefined
        ? dto.options
        : ((existing.options as unknown) ?? null);
    const resolvedCorrectAnswer =
      dto.correctAnswer !== undefined ? dto.correctAnswer : existing.correctAnswer;

    const error = validateQuestionContent({
      type: resolvedType,
      options: (resolvedOptions as any) ?? null,
      correctAnswer: resolvedCorrectAnswer,
    });
    if (error) throw new BadRequestException(error);

    return this.prisma.placementQuestion.update({
      where: { id },
      data: {
        ...(dto.section !== undefined && { section: dto.section }),
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.difficulty !== undefined && { difficulty: dto.difficulty }),
        ...(dto.content !== undefined && { content: dto.content }),
        ...(dto.options !== undefined && {
          options: dto.options as unknown as Prisma.InputJsonValue,
        }),
        ...(dto.correctAnswer !== undefined && {
          correctAnswer: dto.correctAnswer as unknown as Prisma.InputJsonValue,
        }),
        ...(dto.explanation !== undefined && { explanation: dto.explanation }),
        ...(dto.audioUrl !== undefined && { audioUrl: dto.audioUrl }),
        ...(dto.transcript !== undefined && { transcript: dto.transcript }),
        ...(dto.imageUrl !== undefined && { imageUrl: dto.imageUrl }),
      },
      select: MANAGE_PLACEMENT_QUESTION_SELECT,
    });
  }

  async publish(id: string) {
    await this.findOneOrThrow(id);
    return this.prisma.placementQuestion.update({
      where: { id },
      data: { isPublished: true },
      select: MANAGE_PLACEMENT_QUESTION_SELECT,
    });
  }

  async unpublish(id: string) {
    await this.findOneOrThrow(id);
    return this.prisma.placementQuestion.update({
      where: { id },
      data: { isPublished: false },
      select: MANAGE_PLACEMENT_QUESTION_SELECT,
    });
  }

  // No "in use" guard: PlacementAttempt.questionIds is a Json snapshot, not
  // a foreign key, so deleting a question already frozen into a past or
  // in-progress attempt cannot violate a constraint. PlacementService's
  // finalize step treats a questionId with no matching PlacementQuestion row
  // the same as an unanswered one — absence scores as incorrect, exactly
  // like a missing PlacementAnswer row.
  async remove(id: string): Promise<void> {
    await this.findOneOrThrow(id);
    await this.prisma.placementQuestion.delete({ where: { id } });
  }

  private async findOneOrThrow(id: string) {
    const question = await this.prisma.placementQuestion.findUnique({
      where: { id },
    });
    if (!question) {
      throw new NotFoundException(`Placement question with ID ${id} not found`);
    }
    return question;
  }
}
