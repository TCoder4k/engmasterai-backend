import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { LearningGoal, PlacementAttempt, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AnswerPlacementQuestionDto } from './dto';
import { PLACEMENT_TIME_LIMIT_MS } from './placement.constants';
import {
  InsufficientQuestionBankError,
  sampleQuestionIds,
} from './placement-question-selection';
import { scorePlacementAttempt } from './placement-scoring';
import { generateRoadmap, RoadmapCourseCandidate, RoadmapItem } from './roadmap-algorithm';
import {
  PlacementAttemptStateDto,
  PlacementQuestionPublicDto,
  PlacementResultDto,
} from './placement.types';

// Invariant 9's exact discipline, restated for Placement: no correctAnswer,
// no explanation. This is the ONLY select used to serve questions to a
// test-taker anywhere in this service — finalizeNow reads correctAnswer
// through a SEPARATE, unexported select (below), never this one.
const STUDENT_PLACEMENT_QUESTION_SELECT = {
  id: true,
  section: true,
  type: true,
  difficulty: true,
  content: true,
  options: true,
  audioUrl: true,
  imageUrl: true,
};

@Injectable()
export class PlacementService {
  constructor(private readonly prisma: PrismaService) {}

  // Always allowed, never blocked — see the plan's M2 resolution. Does not
  // touch any existing Roadmap; a Roadmap only regenerates via an explicit
  // start/start-beginner call.
  async setGoal(userId: string, goal: LearningGoal) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { learningGoal: goal },
      select: { learningGoal: true },
    });
    return { learningGoal: user.learningGoal };
  }

  // Skip-test path: generates a roadmap from the goal alone (no section
  // scores, no estimated level) and runs the same finalize contract as a
  // graded submit — onboardedAt is stamped only once the Roadmap upsert
  // actually succeeds. Callable again later (e.g. a "regenerate" affordance
  // after changing goal): the Roadmap upsert is keyed on the unique userId,
  // and onboardedAt is only ever set, never re-set.
  async startBeginner(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { learningGoal: true, onboardedAt: true },
    });
    if (!user.learningGoal) {
      throw new BadRequestException(
        'Set a learning goal (PUT /placement/goal) before starting.',
      );
    }

    const availableCourses = await this.loadAvailableCourses();
    const items = generateRoadmap(
      { goal: user.learningGoal, estimatedLevel: null, sectionScores: {} },
      availableCourses,
    );

    await this.persistRoadmapAndMaybeOnboard(userId, {
      goal: user.learningGoal,
      placementAttemptId: null,
      estimatedLevel: null,
      items,
      alreadyOnboarded: user.onboardedAt !== null,
    });

    return { goal: user.learningGoal, roadmapGenerated: true };
  }

  // Idempotent purely on server-side state (no client token): an incomplete
  // attempt, if one exists, is returned UNCHANGED — including its original
  // expiresAt — which is what makes "refresh never resets the timer" true by
  // construction. If that attempt turns out to be past its deadline,
  // finalizeIfDue converts it to completed first and this falls through to
  // minting a fresh one, matching "retakes get a fresh 5-minute attempt".
  async start(userId: string): Promise<PlacementAttemptStateDto> {
    const existing = await this.prisma.placementAttempt.findFirst({
      where: { userId, completedAt: null },
      orderBy: { startedAt: 'desc' },
    });
    if (existing) {
      const finalized = await this.finalizeIfDue(existing);
      if (finalized.completedAt === null) {
        return this.toAttemptState(finalized);
      }
    }

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { learningGoal: true },
    });
    if (!user.learningGoal) {
      throw new BadRequestException(
        'Set a learning goal (PUT /placement/goal) before starting.',
      );
    }

    const published = await this.prisma.placementQuestion.findMany({
      where: { isPublished: true },
      select: { id: true, section: true, difficulty: true },
    });

    let questionIds: string[];
    try {
      questionIds = sampleQuestionIds(published);
    } catch (error) {
      if (error instanceof InsufficientQuestionBankError) {
        throw new ServiceUnavailableException(error.message);
      }
      throw error;
    }

    const startedAt = new Date();
    const expiresAt = new Date(startedAt.getTime() + PLACEMENT_TIME_LIMIT_MS);
    const attempt = await this.prisma.placementAttempt.create({
      data: {
        userId,
        goal: user.learningGoal,
        questionIds: questionIds as unknown as Prisma.InputJsonValue,
        startedAt,
        expiresAt,
      },
    });
    return this.toAttemptState(attempt);
  }

  // Read-only from the caller's point of view, but runs finalizeIfDue first
  // — so a GET on an abandoned, expired attempt is itself what flips it to
  // completed. Once completed (whether it already was, or just became so),
  // there is no "current in-progress attempt" to return: 404, same
  // non-distinguishing-404 discipline lesson-visibility.ts uses.
  async getAttempt(userId: string): Promise<PlacementAttemptStateDto> {
    const attempt = await this.prisma.placementAttempt.findFirst({
      where: { userId, completedAt: null },
      orderBy: { startedAt: 'desc' },
    });
    if (!attempt) throw new NotFoundException('No placement attempt in progress.');

    const finalized = await this.finalizeIfDue(attempt);
    if (finalized.completedAt !== null) {
      throw new NotFoundException('No placement attempt in progress.');
    }
    return this.toAttemptState(finalized);
  }

  // Rejects (never mutates) once completed or past expiresAt — finalizing
  // here would be wasted work on a request that's about to be rejected
  // anyway. The next GET/submit that touches this row is what actually
  // finalizes it; the backend's expiry enforcement does not depend on THIS
  // endpoint doing that job.
  async answer(
    userId: string,
    attemptId: string,
    dto: AnswerPlacementQuestionDto,
  ) {
    const attempt = await this.prisma.placementAttempt.findFirst({
      where: { id: attemptId, userId },
    });
    if (!attempt) throw new NotFoundException('Placement attempt not found.');

    if (attempt.completedAt !== null || Date.now() > attempt.expiresAt.getTime()) {
      throw new ConflictException(
        'This placement attempt is no longer accepting answers.',
      );
    }

    const questionIds = attempt.questionIds as unknown as string[];
    if (!questionIds.includes(dto.questionId)) {
      throw new BadRequestException(
        'This question is not part of the current attempt.',
      );
    }

    await this.prisma.placementAnswer.upsert({
      where: {
        attemptId_questionId: { attemptId, questionId: dto.questionId },
      },
      create: {
        attemptId,
        questionId: dto.questionId,
        submitted: dto.submitted as Prisma.InputJsonValue,
      },
      update: {
        submitted: dto.submitted as Prisma.InputJsonValue,
        answeredAt: new Date(),
      },
    });

    return { questionId: dto.questionId, recorded: true };
  }

  // No body — the graded answer set is always derived from whatever
  // PlacementAnswer rows exist at finalize time, never from anything this
  // request carries (see the plan's "submit's replay contract" note). An
  // already-completed attempt is a pure replay of the stored result; an
  // in-progress one (on-time OR past expiry — both reach here the same way)
  // is graded now. Exactly one grading code path, shared with finalizeIfDue.
  async submit(userId: string, attemptId: string): Promise<PlacementResultDto> {
    const attempt = await this.prisma.placementAttempt.findFirst({
      where: { id: attemptId, userId },
    });
    if (!attempt) throw new NotFoundException('Placement attempt not found.');

    const finalized =
      attempt.completedAt !== null ? attempt : await this.finalizeNow(attempt);
    return this.toResultDto(finalized);
  }

  // --- internal ---------------------------------------------------------

  private async finalizeIfDue(
    attempt: PlacementAttempt,
  ): Promise<PlacementAttempt> {
    if (attempt.completedAt !== null) return attempt;
    if (Date.now() < attempt.expiresAt.getTime()) return attempt;
    return this.finalizeNow(attempt);
  }

  // Grades UNCONDITIONALLY — callers (submit, finalizeIfDue) are responsible
  // for only calling this when finalization should actually happen now.
  // Safe to race: two near-simultaneous calls (e.g. a lazy GET and a manual
  // submit) both compute the same deterministic score from the same
  // persisted answers and both write it — harmless last-write-wins on the
  // attempt row, the same reasoning already applied to PlacementAnswer's
  // concurrent-same-question case. No SELECT FOR UPDATE needed.
  private async finalizeNow(
    attempt: PlacementAttempt,
  ): Promise<PlacementAttempt> {
    const questionIds = attempt.questionIds as unknown as string[];
    const [questions, answers, user] = await Promise.all([
      this.prisma.placementQuestion.findMany({
        where: { id: { in: questionIds } },
        select: { id: true, section: true, type: true, correctAnswer: true },
      }),
      this.prisma.placementAnswer.findMany({
        where: { attemptId: attempt.id },
        select: { questionId: true, submitted: true },
      }),
      this.prisma.user.findUniqueOrThrow({
        where: { id: attempt.userId },
        select: { onboardedAt: true },
      }),
    ]);

    const scoring = scorePlacementAttempt(questionIds, questions, answers);
    const goal = attempt.goal;
    if (!goal) {
      // Cannot happen through the public API — start() guards this before
      // ever creating an attempt — but keeps finalize from silently writing
      // a Roadmap with a null goal if this row was ever reached some other
      // way (e.g. a future admin tool).
      throw new BadRequestException('This attempt has no associated goal.');
    }

    const availableCourses = await this.loadAvailableCourses();
    const items = generateRoadmap(
      {
        goal,
        estimatedLevel: scoring.estimatedLevel,
        sectionScores: {
          GRAMMAR: scoring.grammarScore,
          VOCABULARY: scoring.vocabularyScore,
          LISTENING: scoring.listeningScore,
        },
      },
      availableCourses,
    );

    const now = new Date();
    const durationSeconds = Math.max(
      0,
      Math.round((now.getTime() - attempt.startedAt.getTime()) / 1000),
    );

    const [updatedAttempt] = await this.prisma.$transaction([
      this.prisma.placementAttempt.update({
        where: { id: attempt.id },
        data: {
          grammarScore: scoring.grammarScore,
          vocabularyScore: scoring.vocabularyScore,
          listeningScore: scoring.listeningScore,
          overallScore: scoring.overallScore,
          estimatedLevel: scoring.estimatedLevel,
          completedAt: now,
          durationSeconds,
        },
      }),
      this.prisma.roadmap.upsert({
        where: { userId: attempt.userId },
        create: {
          userId: attempt.userId,
          goal,
          placementAttemptId: attempt.id,
          estimatedLevel: scoring.estimatedLevel,
          items: items as unknown as Prisma.InputJsonValue,
        },
        update: {
          goal,
          placementAttemptId: attempt.id,
          estimatedLevel: scoring.estimatedLevel,
          items: items as unknown as Prisma.InputJsonValue,
          generatedAt: now,
        },
      }),
      ...(user.onboardedAt === null
        ? [
            this.prisma.user.update({
              where: { id: attempt.userId },
              data: { onboardedAt: now },
            }),
          ]
        : []),
    ]);

    return updatedAttempt;
  }

  private async persistRoadmapAndMaybeOnboard(
    userId: string,
    args: {
      goal: NonNullable<PlacementAttempt['goal']>;
      placementAttemptId: string | null;
      estimatedLevel: PlacementAttempt['estimatedLevel'];
      items: RoadmapItem[];
      alreadyOnboarded: boolean;
    },
  ) {
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.roadmap.upsert({
        where: { userId },
        create: {
          userId,
          goal: args.goal,
          placementAttemptId: args.placementAttemptId,
          estimatedLevel: args.estimatedLevel,
          items: args.items as unknown as Prisma.InputJsonValue,
        },
        update: {
          goal: args.goal,
          placementAttemptId: args.placementAttemptId,
          estimatedLevel: args.estimatedLevel,
          items: args.items as unknown as Prisma.InputJsonValue,
          generatedAt: now,
        },
      }),
      ...(args.alreadyOnboarded
        ? []
        : [
            this.prisma.user.update({
              where: { id: userId },
              data: { onboardedAt: now },
            }),
          ]),
    ]);
  }

  private async loadAvailableCourses(): Promise<RoadmapCourseCandidate[]> {
    return this.prisma.course.findMany({
      where: { isPublished: true },
      select: { id: true, type: true, level: true, createdAt: true },
    });
  }

  private async toAttemptState(
    attempt: PlacementAttempt,
  ): Promise<PlacementAttemptStateDto> {
    const questionIds = attempt.questionIds as unknown as string[];
    const [questions, answers] = await Promise.all([
      this.prisma.placementQuestion.findMany({
        where: { id: { in: questionIds } },
        select: STUDENT_PLACEMENT_QUESTION_SELECT,
      }),
      this.prisma.placementAnswer.findMany({
        where: { attemptId: attempt.id },
        select: { questionId: true, submitted: true },
      }),
    ]);

    const questionById = new Map(questions.map((q) => [q.id, q]));
    // options comes back as Prisma.JsonValue (the raw column type); it is
    // actually always QuestionOption[] | null, the same trust boundary
    // grade-question.ts's own callers already cross for this column.
    const orderedQuestions = questionIds
      .map((id) => questionById.get(id))
      .filter((q): q is NonNullable<typeof q> => q != null) as unknown as PlacementQuestionPublicDto[];

    return {
      attemptId: attempt.id,
      goal: attempt.goal,
      startedAt: attempt.startedAt.toISOString(),
      expiresAt: attempt.expiresAt.toISOString(),
      questions: orderedQuestions,
      answers: answers.map((a) => ({
        questionId: a.questionId,
        submitted: a.submitted,
      })),
    };
  }

  private toResultDto(attempt: PlacementAttempt): PlacementResultDto {
    return {
      attemptId: attempt.id,
      grammarScore: attempt.grammarScore!,
      vocabularyScore: attempt.vocabularyScore!,
      listeningScore: attempt.listeningScore!,
      overallScore: attempt.overallScore!,
      estimatedLevel: attempt.estimatedLevel!,
      durationSeconds: attempt.durationSeconds,
      completedAt: attempt.completedAt!.toISOString(),
    };
  }
}
