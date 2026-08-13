import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  CefrLevel,
  LearningGoal,
  LevelSource,
  PlacementAttempt,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { gradeQuestion, QuestionOption } from '../lesson/quiz/grade-question';
import { getEstimatedMinutesByCourseId } from '../shared/estimated-minutes';
import { AnswerPlacementQuestionDto } from './dto';
import { PLACEMENT_TIME_LIMIT_MS } from './placement.constants';
import {
  InsufficientQuestionBankError,
  sampleQuestionIds,
} from './placement-question-selection';
import { scorePlacementAttempt } from './placement-scoring';
import {
  generateRoadmap,
  RoadmapResourceCandidate,
  RoadmapItem,
} from './roadmap-algorithm';
import { normalizeRoadmapItem } from './roadmap-item-compat';
import { validateRoadmapPlan } from './validate-roadmap-plan';
import {
  ROADMAP_ANALYSIS_PROVIDER,
  RoadmapAnalysisError,
} from './roadmap/roadmap-analysis.provider';
import type {
  RoadmapAnalysisPhase,
  RoadmapAnalysisProvider,
  RoadmapAnalysisSectionScores,
} from './roadmap/roadmap-analysis.provider';
import {
  ROADMAP_PLANNER_PROVIDER,
  RoadmapPlanningError,
} from './roadmap/roadmap-planner.provider';
import type {
  RoadmapPlannerProvider,
  RoadmapPlanningResult,
} from './roadmap/roadmap-planner.provider';
import {
  PlacementAttemptStateDto,
  PlacementQuestionPublicDto,
  PlacementResultDto,
  PlacementReviewDto,
  PlacementReviewItemDto,
  PlacementStatusDto,
  RoadmapAnalysisResultDto,
  RoadmapViewDto,
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
  transcript: true,
  imageUrl: true,
};

@Injectable()
export class PlacementService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ROADMAP_ANALYSIS_PROVIDER)
    private readonly roadmapAnalysis: RoadmapAnalysisProvider,
    @Inject(ROADMAP_PLANNER_PROVIDER)
    private readonly roadmapPlanner: RoadmapPlannerProvider,
  ) {}

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

  // Wizard-internal resume authority (see placement.types.ts's header note
  // on PlacementStatusDto — never the app-wide onboarding gate). Runs
  // finalizeIfDue on any in-progress attempt FIRST, then reads
  // onboarded/roadmap fresh afterward — so if that check just lazily
  // finalized an abandoned expired attempt, this response reflects the
  // post-finalize truth (onboarded: true, hasRoadmap: true) rather than a
  // snapshot taken before the mutation.
  async getStatus(userId: string): Promise<PlacementStatusDto> {
    const inProgress = await this.prisma.placementAttempt.findFirst({
      where: { userId, completedAt: null },
      orderBy: { startedAt: 'desc' },
    });

    let attemptExpiresAt: Date | null = null;
    if (inProgress) {
      const finalized = await this.finalizeIfDue(inProgress);
      if (finalized.completedAt === null) {
        attemptExpiresAt = finalized.expiresAt;
      }
    }

    const [user, roadmap] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { onboardedAt: true, learningGoal: true },
      }),
      this.prisma.roadmap.findUnique({
        where: { userId },
        select: { id: true },
      }),
    ]);

    return {
      onboarded: user.onboardedAt !== null,
      learningGoal: user.learningGoal,
      hasInProgressAttempt: attemptExpiresAt !== null,
      attemptExpiresAt: attemptExpiresAt
        ? attemptExpiresAt.toISOString()
        : null,
      hasRoadmap: roadmap !== null,
    };
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

    const availableResources = await this.loadAvailableResources(
      user.learningGoal,
    );
    // The student chose to skip the test — not a declared A1, an ASSUMED
    // one. 'A1' is a real, non-null CefrLevel so pickResource() can use its
    // level-aware branch instead of blindly picking the earliest-ordered
    // resource in each pillar; levelSource is what tells buildReason()/the
    // consolidation phase this isn't backed by real section scores.
    const items = generateRoadmap(
      {
        goal: user.learningGoal,
        estimatedLevel: 'A1',
        levelSource: 'BEGINNER_ASSUMED',
        sectionScores: null,
      },
      availableResources,
    );

    await this.persistRoadmapAndMaybeOnboard(userId, {
      goal: user.learningGoal,
      placementAttemptId: null,
      estimatedLevel: 'A1',
      levelSource: 'BEGINNER_ASSUMED',
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
    if (!attempt)
      throw new NotFoundException('No placement attempt in progress.');

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

    if (
      attempt.completedAt !== null ||
      Date.now() > attempt.expiresAt.getTime()
    ) {
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

  // "Xem chi tiết bài làm" on the Result screen. Only ever reachable for a
  // COMPLETED attempt — Invariant 9 still governs an in-progress one, which
  // is why this rejects rather than silently finalizing early the way
  // `submit` does. PlacementAnswer has no `isCorrect` column (only
  // aggregate section scores are persisted at finalize time — see
  // finalizeNow), so correctness is re-derived here the same way
  // scorePlacementAttempt already does: gradeQuestion() against each
  // question's own correctAnswer, never stored, never trusted from the
  // client.
  async getAttemptReview(
    userId: string,
    attemptId: string,
  ): Promise<PlacementReviewDto> {
    const attempt = await this.prisma.placementAttempt.findFirst({
      where: { id: attemptId, userId },
    });
    if (!attempt) throw new NotFoundException('Placement attempt not found.');
    if (attempt.completedAt === null) {
      throw new ConflictException(
        'This placement attempt has not been completed yet.',
      );
    }

    const questionIds = attempt.questionIds as unknown as string[];
    const [questions, answers] = await Promise.all([
      this.prisma.placementQuestion.findMany({
        where: { id: { in: questionIds } },
        select: {
          id: true,
          section: true,
          type: true,
          content: true,
          options: true,
          audioUrl: true,
          transcript: true,
          imageUrl: true,
          correctAnswer: true,
          explanation: true,
        },
      }),
      this.prisma.placementAnswer.findMany({
        where: { attemptId },
        select: { questionId: true, submitted: true },
      }),
    ]);

    const questionById = new Map(questions.map((q) => [q.id, q]));
    const submittedById = new Map(answers.map((a) => [a.questionId, a.submitted]));

    // Ordered by the attempt's own questionIds (the order the student
    // actually saw them in), same as toAttemptState — never DB insertion
    // order. A questionId with no matching row (deleted since the attempt
    // was taken) is dropped, same tolerance finalizeNow already has for it.
    const items: PlacementReviewItemDto[] = questionIds
      .map((id) => questionById.get(id))
      .filter((q): q is NonNullable<typeof q> => q != null)
      .map((q) => {
        const submitted = submittedById.get(q.id) ?? null;
        const isCorrect =
          submitted !== null &&
          gradeQuestion({ type: q.type, correctAnswer: q.correctAnswer }, submitted);
        return {
          questionId: q.id,
          section: q.section,
          type: q.type,
          content: q.content,
          options: q.options as unknown as QuestionOption[] | null,
          audioUrl: q.audioUrl,
          transcript: q.transcript,
          imageUrl: q.imageUrl,
          submitted,
          isCorrect,
          correctAnswer: q.correctAnswer,
          explanation: q.explanation,
        };
      });

    return { attemptId: attempt.id, items };
  }

  // Joins Roadmap.items against LIVE Course/VocabLibrary/ListeningCategory
  // rows on every read — never a stored snapshot (see roadmap-algorithm.ts's
  // header note and Roadmap's own schema comment on `items`). An item whose
  // resource has since been unpublished or deleted is dropped, mirroring
  // filterAccessibleCourses' discipline (lesson-visibility.ts): stale
  // content is omitted, not surfaced with a broken title. `items` is run
  // through normalizeRoadmapItem first so a pre-multi-pillar row (Course-
  // only shape) keeps reading correctly forever — see roadmap-item-compat.ts.
  async getRoadmap(userId: string): Promise<RoadmapViewDto> {
    const roadmap = await this.prisma.roadmap.findUnique({ where: { userId } });
    if (!roadmap) {
      throw new NotFoundException('No roadmap has been generated yet.');
    }

    const items = (roadmap.items as unknown[]).map(normalizeRoadmapItem);
    const joined = await this.joinLiveResources(items);

    return {
      goal: roadmap.goal,
      estimatedLevel: roadmap.estimatedLevel,
      levelSource: roadmap.levelSource,
      placementAttemptId: roadmap.placementAttemptId,
      generatedAt: roadmap.generatedAt.toISOString(),
      aiSummary: roadmap.aiSummary,
      // Derived, not stored — see RoadmapViewDto's own comment.
      aiPlanningUsed: roadmap.aiPlanningModel !== null,
      items: joined.map(({ item, resource }) => ({
        phase: item.phase,
        pillar: item.pillar,
        resourceType: item.resourceType,
        resourceId: item.resourceId,
        resourceTitle: resource.title,
        resourceThumbnail: resource.thumbnail,
        reason: item.reason,
        totalEstimatedMinutes: resource.totalEstimatedMinutes,
      })),
    };
  }

  /**
   * Phase 6 — cached-before-called AI narrative on top of the deterministic
   * roadmap. Mirrors ShadowingService.requestFeedback exactly: findUnique ->
   * cache-check -> generate -> plain .update(). No transaction, because this
   * row already exists and nothing else changes with it — losing the write
   * after a successful (paid) call costs one repeated request, the cheapest
   * failure available here.
   */
  async requestRoadmapAnalysis(
    userId: string,
  ): Promise<RoadmapAnalysisResultDto> {
    const roadmap = await this.prisma.roadmap.findUnique({
      where: { userId },
      select: {
        id: true,
        goal: true,
        estimatedLevel: true,
        placementAttemptId: true,
        items: true,
        aiSummary: true,
        aiSummaryAt: true,
        aiSummaryModel: true,
      },
    });
    if (!roadmap) {
      throw new NotFoundException('No roadmap has been generated yet.');
    }

    // Returned BEFORE calling the engine, same two reasons Shadowing's own
    // cache-check has: it costs money, and a second narrative that
    // contradicts the first is worse than none.
    if (roadmap.aiSummary && roadmap.aiSummaryAt) {
      return {
        summary: roadmap.aiSummary,
        generatedAt: roadmap.aiSummaryAt.toISOString(),
        model: roadmap.aiSummaryModel ?? this.roadmapAnalysis.model,
        cached: true,
      };
    }

    const [phases, sectionScores] = await Promise.all([
      this.describePhases((roadmap.items as unknown[]).map(normalizeRoadmapItem)),
      this.loadSectionScores(roadmap.placementAttemptId),
    ]);

    const summary = await this.generateAnalysis({
      goal: roadmap.goal,
      estimatedLevel: roadmap.estimatedLevel,
      sectionScores,
      phases,
    });

    const model = this.roadmapAnalysis.model;
    const now = new Date();
    await this.prisma.roadmap.update({
      where: { id: roadmap.id },
      data: { aiSummary: summary, aiSummaryAt: now, aiSummaryModel: model },
    });

    return { summary, generatedAt: now.toISOString(), model, cached: false };
  }

  /**
   * POST /placement/roadmap/plan — hybrid AI-assisted, multi-pillar resource
   * SELECTION. Deterministic candidate filtering (loadAvailableResources,
   * the SAME function generateRoadmap itself uses — see its own header) ->
   * AI planner picks/orders from that closed set across all three pillars
   * -> strict server-side validation (allow-list + pillar-coverage) ->
   * conditional persist of `items` AND `aiSummary` together (one Gemini
   * call, one write — see roadmap-planner.provider.ts's header on why this
   * plan does not chain into the separate, now-deprecated
   * `/placement/roadmap/analysis`). On ANY failure along that chain
   * (provider unavailable, invalid output, or the roadmap having changed
   * underneath this call — see the concurrency comment below) this method
   * falls back to whatever roadmap is currently persisted rather than
   * throwing: a request to `/plan` always resolves with SOME valid roadmap,
   * `aiPlanningUsed` telling the caller which kind it got.
   */
  async requestRoadmapPlan(userId: string): Promise<RoadmapViewDto> {
    const roadmap = await this.prisma.roadmap.findUnique({
      where: { userId },
      select: {
        goal: true,
        estimatedLevel: true,
        levelSource: true,
        placementAttemptId: true,
        generatedAt: true,
        aiPlanningUsedAt: true,
      },
    });
    if (!roadmap) {
      throw new NotFoundException('No roadmap has been generated yet.');
    }

    // Legacy row from before levelSource existed — there is nothing to build
    // an AI planning request from (estimatedLevel/levelSource together are
    // what every post-migration row always has). Rather than guess, just
    // return the roadmap as-is; it already went through the deterministic
    // algorithm at its own generation time.
    if (!roadmap.estimatedLevel || !roadmap.levelSource) {
      return this.getRoadmap(userId);
    }

    // Idempotency, backend-authoritative: a successful AI plan already
    // exists for THIS deterministic generation. The frontend fires this
    // call on mount with no de-duplication of its own (a refresh, a
    // back/forward navigation onto the Result screen, or a React
    // StrictMode double-invoke would each re-trigger it) — so the backend,
    // not the caller's lifecycle, must be the single source of truth for
    // "has this generation already been AI-planned". aiPlanningUsedAt is
    // cleared to null only by a retake's fresh generateRoadmap() (see
    // finalizeNow/persistRoadmapAndMaybeOnboard), so this doubles cleanly as
    // both the "was AI used" display flag (already shipped) and this
    // per-generation idempotency gate. A FAILED attempt (provider error,
    // invalid plan) leaves this at null, so the next call is free to retry.
    if (roadmap.aiPlanningUsedAt !== null) {
      return this.getRoadmap(userId);
    }

    // Captured BEFORE the (potentially ~20s) Gemini call — this is the
    // optimistic-concurrency snapshot the final write below is conditioned
    // on. generatedAt is bumped ONLY by writes that change items/
    // estimatedLevel (finalizeNow, persistRoadmapAndMaybeOnboard) — never by
    // this method's own update or requestRoadmapAnalysis's — so a mismatch
    // here means specifically "a retake happened while this call was in
    // flight", never a false positive from an unrelated concurrent write.
    const snapshot = roadmap.generatedAt;

    const [candidates, sectionScores] = await Promise.all([
      this.loadAvailableResources(roadmap.goal),
      this.loadSectionScores(roadmap.placementAttemptId),
    ]);

    let planResult: RoadmapPlanningResult | null;
    try {
      planResult = await this.roadmapPlanner.plan({
        goal: roadmap.goal,
        estimatedLevel: roadmap.estimatedLevel,
        levelSource: roadmap.levelSource,
        sectionScores,
        candidates,
      });
    } catch (error) {
      if (!(error instanceof RoadmapPlanningError)) throw error;
      // Unavailable/timeout/not-configured — no exception surfaces to the
      // caller; the deterministic roadmap already persisted is the fallback.
      planResult = null;
    }

    if (planResult) {
      // Re-validate against the LATEST candidate set, not the one the
      // prompt was built from moments ago — a resource could have been
      // unpublished or retagged while Gemini was in flight.
      const freshCandidates = await this.loadAvailableResources(roadmap.goal);
      const validated = validateRoadmapPlan(planResult, freshCandidates);

      if (validated) {
        // CONDITIONAL WRITE — the concurrency invariant, extended to also
        // guard the idempotency invariant above. `generatedAt: snapshot`
        // catches a retake racing this call (the newer, already-correct
        // roadmap must never be overwritten by a plan computed against a
        // profile that no longer exists). `aiPlanningUsedAt: null` catches a
        // race between two /plan calls for the SAME generation (e.g. a
        // StrictMode double-invoke): if both pass the read-time idempotency
        // check above and both call Gemini, only the first writer's `count`
        // comes back 1 — the second finds aiPlanningUsedAt no longer null
        // and its own (redundant but harmless) result is silently discarded.
        await this.prisma.roadmap.updateMany({
          where: { userId, generatedAt: snapshot, aiPlanningUsedAt: null },
          data: {
            items: validated.items as unknown as Prisma.InputJsonValue,
            // Written together with `items` so the dormant, deprecated
            // requestRoadmapAnalysis() cache-check (which only looks at
            // aiSummary/aiSummaryAt) correctly treats this as already
            // populated if it's ever called on this roadmap, and so its
            // attribution is accurate rather than silently falling back to
            // the analysis provider's own model name.
            aiSummary: validated.overallReason,
            aiSummaryAt: new Date(),
            aiSummaryModel: this.roadmapPlanner.model,
            aiPlanningModel: this.roadmapPlanner.model,
            aiPlanningUsedAt: new Date(),
          },
        });
      }
    }

    // Always re-read fresh: this is what makes every branch above (success,
    // validation failure, provider failure, discarded-stale-write) converge
    // on the same "return whatever is currently, correctly persisted" path.
    return this.getRoadmap(userId);
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

    const availableResources = await this.loadAvailableResources(goal);
    const items = generateRoadmap(
      {
        goal,
        estimatedLevel: scoring.estimatedLevel,
        levelSource: 'TEST_GRADED',
        sectionScores: {
          GRAMMAR: scoring.grammarScore,
          VOCABULARY: scoring.vocabularyScore,
          LISTENING: scoring.listeningScore,
        },
      },
      availableResources,
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
          levelSource: 'TEST_GRADED',
          items: items as unknown as Prisma.InputJsonValue,
        },
        update: {
          goal,
          placementAttemptId: attempt.id,
          estimatedLevel: scoring.estimatedLevel,
          levelSource: 'TEST_GRADED',
          items: items as unknown as Prisma.InputJsonValue,
          generatedAt: now,
          // Phase 7 (retake) — a regenerated roadmap invalidates any cached
          // narrative: it was written FOR the previous items/estimatedLevel,
          // and serving it beside a new roadmap would describe phases that
          // are no longer the plan. Cleared, not regenerated inline, so this
          // stays a pure, cheap write — the next GET /placement/roadmap or
          // POST .../analysis call is what actually asks for a fresh one.
          aiSummary: null,
          aiSummaryAt: null,
          aiSummaryModel: null,
          // Same staleness fix, extended to AI PLANNING (POST
          // /placement/roadmap/plan): a plan chosen for the previous
          // profile must not be described as current once that profile no
          // longer exists. Bumping generatedAt (above) is also what lets an
          // in-flight /plan call detect this retake happened underneath it
          // — see requestRoadmapPlan's optimistic-concurrency write.
          aiPlanningModel: null,
          aiPlanningUsedAt: null,
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
      levelSource: LevelSource;
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
          levelSource: args.levelSource,
          items: args.items as unknown as Prisma.InputJsonValue,
        },
        update: {
          goal: args.goal,
          placementAttemptId: args.placementAttemptId,
          estimatedLevel: args.estimatedLevel,
          levelSource: args.levelSource,
          items: args.items as unknown as Prisma.InputJsonValue,
          generatedAt: now,
          // Same staleness fix as finalizeNow's own upsert — see its comment.
          aiSummary: null,
          aiSummaryAt: null,
          aiSummaryModel: null,
          aiPlanningModel: null,
          aiPlanningUsedAt: null,
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

  // THE single canonical candidate loader — both the deterministic
  // algorithm (generateRoadmap, called from startBeginner/finalizeNow
  // below) and the AI planner's prompt builder (requestRoadmapPlan) call
  // this SAME method with the SAME goal and get the SAME filtered,
  // identically-shaped result. There is deliberately no second, separately
  // filtered candidate loader — two independently-maintained "which
  // resources are eligible" filters would silently drift apart the moment
  // one is updated and the other isn't, which would undermine the AI
  // validation step's own allow-list guarantee (see requestRoadmapPlan).
  //
  // Queries all three pillar tables in parallel, each filtered identically:
  // suitableGoals: [] means "eligible for every goal" (Course.suitableGoals'
  // own default/documented semantics, mirrored on VocabLibrary/
  // ListeningCategory), hence the OR rather than a plain `has` filter — an
  // untagged resource must not silently vanish from every roadmap the
  // moment this field started existing. Course is additionally filtered to
  // type: GRAMMAR — the fixed pillar<->resourceType mapping (see
  // roadmap-algorithm.ts's header) means a Course row typed VOCABULARY or
  // LISTENING is dormant for roadmap purposes; Vocabulary/Listening pillars
  // are backed by VocabLibrary/ListeningCategory instead.
  private async loadAvailableResources(
    goal: LearningGoal,
  ): Promise<RoadmapResourceCandidate[]> {
    const goalFilter = {
      OR: [{ suitableGoals: { isEmpty: true } }, { suitableGoals: { has: goal } }],
    };

    const [courses, libraries, categories] = await Promise.all([
      this.prisma.course.findMany({
        where: { isPublished: true, type: 'GRAMMAR', ...goalFilter },
        select: {
          id: true,
          level: true,
          createdAt: true,
          title: true,
          description: true,
          suitableGoals: true,
        },
      }),
      this.prisma.vocabLibrary.findMany({
        where: { isPublished: true, ...goalFilter },
        select: {
          id: true,
          level: true,
          orderIndex: true,
          name: true,
          description: true,
          suitableGoals: true,
        },
      }),
      this.prisma.listeningCategory.findMany({
        where: { isPublished: true, ...goalFilter },
        select: {
          id: true,
          level: true,
          orderIndex: true,
          name: true,
          nameVi: true,
          suitableGoals: true,
        },
      }),
    ]);

    return [
      ...courses.map((c) => ({
        resourceType: 'COURSE' as const,
        id: c.id,
        pillar: 'GRAMMAR' as const,
        level: c.level,
        sortKey: c.createdAt.getTime(),
        title: c.title,
        description: c.description,
        suitableGoals: c.suitableGoals,
      })),
      ...libraries.map((l) => ({
        resourceType: 'VOCAB_LIBRARY' as const,
        id: l.id,
        pillar: 'VOCABULARY' as const,
        level: l.level,
        sortKey: l.orderIndex,
        title: l.name,
        description: l.description,
        suitableGoals: l.suitableGoals,
      })),
      ...categories.map((cat) => ({
        resourceType: 'LISTENING_CATEGORY' as const,
        id: cat.id,
        pillar: 'LISTENING' as const,
        level: cat.level,
        sortKey: cat.orderIndex,
        // nameVi is the display title (the student UI is Vietnamese-first,
        // same reasoning ListeningCategoryDto's own consumers already
        // follow); `name` (English) rides along as the description.
        title: cat.nameVi,
        description: cat.name,
        suitableGoals: cat.suitableGoals,
      })),
    ];
  }

  // Shared by getRoadmap and describePhases: both need Roadmap.items joined
  // against LIVE Course/VocabLibrary/ListeningCategory rows (never a stored
  // snapshot — see Roadmap.items' schema comment), they just render the
  // join differently. An item whose resource has since been unpublished or
  // deleted is dropped here, once, for both callers — mirroring
  // filterAccessibleCourses' discipline (lesson-visibility.ts): stale
  // content is omitted, not surfaced stale.
  private async joinLiveResources(items: RoadmapItem[]): Promise<
    Array<{
      item: RoadmapItem;
      resource: {
        title: string;
        thumbnail: string | null;
        totalEstimatedMinutes: number;
      };
    }>
  > {
    const courseIds = items
      .filter((i) => i.resourceType === 'COURSE')
      .map((i) => i.resourceId);
    const libraryIds = items
      .filter((i) => i.resourceType === 'VOCAB_LIBRARY')
      .map((i) => i.resourceId);
    const categoryIds = items
      .filter((i) => i.resourceType === 'LISTENING_CATEGORY')
      .map((i) => i.resourceId);

    const [courses, libraries, categories, minutesByCourse] = await Promise.all([
      this.prisma.course.findMany({
        where: { id: { in: courseIds }, isPublished: true },
        select: { id: true, title: true, thumbnail: true },
      }),
      this.prisma.vocabLibrary.findMany({
        where: { id: { in: libraryIds }, isPublished: true },
        select: { id: true, name: true, thumbnail: true },
      }),
      this.prisma.listeningCategory.findMany({
        where: { id: { in: categoryIds }, isPublished: true },
        select: { id: true, nameVi: true },
      }),
      // Same shared helper CourseService's own course-card tile uses — see
      // shared/estimated-minutes.ts's header for why this isn't
      // reimplemented here. VocabLibrary/ListeningCategory have no
      // equivalent aggregate; those items get 0 (never fabricated).
      getEstimatedMinutesByCourseId(this.prisma, courseIds),
    ]);

    const resourceByKey = new Map<
      string,
      { title: string; thumbnail: string | null; totalEstimatedMinutes: number }
    >();
    for (const c of courses) {
      resourceByKey.set(`COURSE:${c.id}`, {
        title: c.title,
        thumbnail: c.thumbnail,
        totalEstimatedMinutes: minutesByCourse.get(c.id) ?? 0,
      });
    }
    for (const l of libraries) {
      resourceByKey.set(`VOCAB_LIBRARY:${l.id}`, {
        title: l.name,
        thumbnail: l.thumbnail,
        totalEstimatedMinutes: 0,
      });
    }
    for (const cat of categories) {
      // ListeningCategory has no thumbnail column at all — always null,
      // handled by the existing MapPin-fallback rendering on the frontend.
      resourceByKey.set(`LISTENING_CATEGORY:${cat.id}`, {
        title: cat.nameVi,
        thumbnail: null,
        totalEstimatedMinutes: 0,
      });
    }

    return items
      .map((item) => {
        const resource = resourceByKey.get(`${item.resourceType}:${item.resourceId}`);
        return resource ? { item, resource } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x != null);
  }

  private async describePhases(
    items: RoadmapItem[],
  ): Promise<RoadmapAnalysisPhase[]> {
    const joined = await this.joinLiveResources(items);
    return joined.map(({ item, resource }) => ({
      phase: item.phase,
      courseType: item.pillar,
      courseTitle: resource.title,
      reason: item.reason,
    }));
  }

  // Null on the beginner-skip path — no test was ever taken, so there is
  // nothing to score. When an attempt id IS present, its scores are
  // guaranteed non-null: finalizeNow only ever sets placementAttemptId on a
  // Roadmap in the SAME transaction that sets that same attempt's scores
  // (see finalizeNow above), so the two can never disagree.
  private async loadSectionScores(
    placementAttemptId: string | null,
  ): Promise<RoadmapAnalysisSectionScores | null> {
    if (!placementAttemptId) return null;
    const attempt = await this.prisma.placementAttempt.findUniqueOrThrow({
      where: { id: placementAttemptId },
      select: {
        grammarScore: true,
        vocabularyScore: true,
        listeningScore: true,
      },
    });
    return {
      grammar: attempt.grammarScore!,
      vocabulary: attempt.vocabularyScore!,
      listening: attempt.listeningScore!,
    };
  }

  private async generateAnalysis(input: {
    goal: LearningGoal;
    estimatedLevel: CefrLevel | null;
    sectionScores: RoadmapAnalysisSectionScores | null;
    phases: RoadmapAnalysisPhase[];
  }): Promise<string> {
    try {
      const result = await this.roadmapAnalysis.generate(input);
      return result.summary;
    } catch (caught) {
      if (caught instanceof RoadmapAnalysisError) {
        throw new ServiceUnavailableException(
          caught.kind === 'TIMEOUT'
            ? 'AI roadmap analysis timed out. Please try again.'
            : 'AI roadmap analysis is unavailable. Please try again shortly.',
        );
      }
      throw caught;
    }
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
      .filter(
        (q): q is NonNullable<typeof q> => q != null,
      ) as unknown as PlacementQuestionPublicDto[];

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
