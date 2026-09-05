import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PlacementService } from './placement.service';
import { RoadmapAnalysisError } from './roadmap/roadmap-analysis.provider';
import { RoadmapPlanningError } from './roadmap/roadmap-planner.provider';

// Against a mocked Prisma, same technique as
// placement-question.service.spec.ts / dashboard-analytics.service.spec.ts:
// a plain object standing in for PrismaService, instantiated directly.
//
// $transaction here mirrors Prisma's ARRAY form: the service calls
// `this.prisma.$transaction([opA, opB, ...])` where each element is already
// a Promise (the individually-mocked calls run eagerly), so the mock is
// just Promise.all over whatever was handed to it.

const NOW = new Date('2026-08-11T10:00:00.000Z');

const buildHarness = (
  attemptOverrides: Record<string, unknown> = {},
  userOverrides: Record<string, unknown> = {},
) => {
  const attempt = {
    id: 'attempt-1',
    userId: 'user-1',
    goal: 'FOUNDATION',
    questionIds: [
      'g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7', 'g8',
      'v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8',
      'l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7', 'l8',
    ],
    startedAt: new Date(NOW.getTime() - 60_000),
    expiresAt: new Date(NOW.getTime() + 4 * 60_000), // 4 min remaining by default
    completedAt: null,
    grammarScore: null,
    vocabularyScore: null,
    listeningScore: null,
    overallScore: null,
    estimatedLevel: null,
    durationSeconds: null,
    ...attemptOverrides,
  };

  const user = {
    id: 'user-1',
    learningGoal: 'FOUNDATION',
    onboardedAt: null as Date | null,
    ...userOverrides,
  };

  // One row per bucket the fixed 24-question shape needs (3 EASY / 3 MEDIUM
  // / 2 HARD per section) — matches DIFFICULTY_REQUIREMENTS exactly, with no
  // slack, so sampleQuestionIds succeeds against this bank. Same ids as
  // attempt.questionIds above by construction.
  const questionDefs = [
    { id: 'g1', section: 'GRAMMAR', difficulty: 'EASY' },
    { id: 'g2', section: 'GRAMMAR', difficulty: 'EASY' },
    { id: 'g3', section: 'GRAMMAR', difficulty: 'EASY' },
    { id: 'g4', section: 'GRAMMAR', difficulty: 'MEDIUM' },
    { id: 'g5', section: 'GRAMMAR', difficulty: 'MEDIUM' },
    { id: 'g6', section: 'GRAMMAR', difficulty: 'MEDIUM' },
    { id: 'g7', section: 'GRAMMAR', difficulty: 'HARD' },
    { id: 'g8', section: 'GRAMMAR', difficulty: 'HARD' },
    { id: 'v1', section: 'VOCABULARY', difficulty: 'EASY' },
    { id: 'v2', section: 'VOCABULARY', difficulty: 'EASY' },
    { id: 'v3', section: 'VOCABULARY', difficulty: 'EASY' },
    { id: 'v4', section: 'VOCABULARY', difficulty: 'MEDIUM' },
    { id: 'v5', section: 'VOCABULARY', difficulty: 'MEDIUM' },
    { id: 'v6', section: 'VOCABULARY', difficulty: 'MEDIUM' },
    { id: 'v7', section: 'VOCABULARY', difficulty: 'HARD' },
    { id: 'v8', section: 'VOCABULARY', difficulty: 'HARD' },
    { id: 'l1', section: 'LISTENING', difficulty: 'EASY' },
    { id: 'l2', section: 'LISTENING', difficulty: 'EASY' },
    { id: 'l3', section: 'LISTENING', difficulty: 'EASY' },
    { id: 'l4', section: 'LISTENING', difficulty: 'MEDIUM' },
    { id: 'l5', section: 'LISTENING', difficulty: 'MEDIUM' },
    { id: 'l6', section: 'LISTENING', difficulty: 'MEDIUM' },
    { id: 'l7', section: 'LISTENING', difficulty: 'HARD' },
    { id: 'l8', section: 'LISTENING', difficulty: 'HARD' },
  ];
  const questionRows = questionDefs.map((d) => ({
    ...d,
    type: 'TRUE_FALSE',
    content: d.id,
    options: null,
    audioUrl: null,
    imageUrl: null,
    correctAnswer: { value: true },
  }));

  const placementAttemptFindFirst = jest.fn(() =>
    Promise.resolve(attempt as never),
  );
  const placementAttemptCreate = jest.fn(
    (args: { data: Record<string, unknown> }) =>
      Promise.resolve({
        ...attempt,
        id: 'attempt-2',
        completedAt: null,
        ...args.data,
      } as never),
  );
  const placementAttemptUpdate = jest.fn(
    (args: { data: Record<string, unknown> }) =>
      Promise.resolve({ ...attempt, ...args.data } as never),
  );
  // Phase 6's loadSectionScores — only ever called with a real
  // placementAttemptId, i.e. after finalizeNow already stamped scores.
  const placementAttemptFindUniqueOrThrow = jest.fn(() =>
    Promise.resolve(attempt as never),
  );

  const userFindUniqueOrThrow = jest.fn(() => Promise.resolve(user as never));
  const userUpdate = jest.fn((args: { data: Record<string, unknown> }) =>
    Promise.resolve({ ...user, ...args.data } as never),
  );

  // Distinguishes POST /placement/start's SAMPLING call (where: {isPublished})
  // from finalizeNow/toAttemptState's BY-ID call (where: {id: {in: [...]}}) —
  // the two need different response shapes and cannot share one fixed return
  // value.
  const placementQuestionFindMany = jest.fn(
    (args: { where?: Record<string, unknown> }) => {
      if (args?.where && 'isPublished' in args.where) {
        return Promise.resolve(questionDefs as never);
      }
      const ids = (args?.where?.id as { in?: string[] } | undefined)?.in ?? [];
      return Promise.resolve(
        questionRows.filter((q) => ids.includes(q.id)) as never,
      );
    },
  );
  const placementAnswerFindMany = jest.fn(() => Promise.resolve([] as never));
  const placementAnswerUpsert = jest.fn(() => Promise.resolve({} as never));
  const roadmapUpsert = jest.fn((args: { create: unknown }) =>
    Promise.resolve(args.create as never),
  );
  const roadmapFindUnique = jest.fn(() => Promise.resolve(null as never));
  const roadmapUpdate = jest.fn((args: { data: Record<string, unknown> }) =>
    Promise.resolve(args.data as never),
  );
  // Phase 4 — requestRoadmapPlan's conditional write. Defaults to "the
  // condition matched" (count: 1); tests exercising the concurrency guard
  // override this to 0 to simulate a retake racing an in-flight AI call.
  const roadmapUpdateMany = jest.fn(() => Promise.resolve({ count: 1 } as never));
  const courseFindMany = jest.fn(() => Promise.resolve([] as never));
  // Multi-pillar: loadAvailableResources/joinLiveResources query all 3
  // tables in parallel. Empty by default, same as courseFindMany, so a test
  // that only cares about the GRAMMAR pillar doesn't need to mock these.
  const vocabLibraryFindMany = jest.fn(() => Promise.resolve([] as never));
  const listeningCategoryFindMany = jest.fn(() => Promise.resolve([] as never));
  // Fourth, OPTIONAL source — only ever queried by loadAvailableResources
  // when goal === 'GENERAL_ENGLISH' (fail-closed, see the header comment on
  // loadAvailableResources). Empty by default, same as the other three.
  // Typed with an explicit args parameter (unlike courseFindMany/etc. above)
  // so `.mock.calls[0][0]` is a valid index below — a same-arity no-args
  // jest.fn() infers Parameters as `[]`, which TypeScript then refuses to
  // index into.
  const speakingScenarioFindMany = jest.fn(
    (_args?: { where?: Record<string, unknown> }) => Promise.resolve([] as never),
  );
  // Backs getEstimatedMinutesByCourseId (shared/estimated-minutes.ts), called
  // by joinLiveResources. Empty by default -> totalEstimatedMinutes falls
  // back to 0 for every course, same as CourseService's own `?? 0` convention.
  const lessonGroupBy = jest.fn(() => Promise.resolve([] as never));

  // Phase 6 — a fake RoadmapAnalysisProvider, the same DI-token seam
  // GeminiRoadmapAnalysisProvider sits behind in production (see
  // placement.module.ts). Directly controllable, unlike a real Gemini call.
  const roadmapAnalysisGenerate = jest.fn(() =>
    Promise.resolve({
      summary: 'A generated orientation paragraph.',
      model: 'fake-roadmap-model',
    }),
  );
  const roadmapAnalysis = {
    generate: roadmapAnalysisGenerate,
  };

  // Phase 4 — same seam as roadmapAnalysis above, for the AI PLANNING
  // provider. Defaults to an empty plan (no phases), which
  // validateRoadmapPlan rejects -> requestRoadmapPlan falls back to the
  // deterministic roadmap. Individual tests override this to exercise the
  // success/rejection/failure paths.
  const roadmapPlannerPlan = jest.fn(() =>
    Promise.resolve({
      phases: [] as { resourceType: string; resourceId: string; reason: string }[],
      overallReason: '',
      model: 'fake-planner-model',
    }),
  );
  const roadmapPlanner = {
    plan: roadmapPlannerPlan,
  };

  const prisma = {
    placementAttempt: {
      findFirst: placementAttemptFindFirst,
      findUniqueOrThrow: placementAttemptFindUniqueOrThrow,
      create: placementAttemptCreate,
      update: placementAttemptUpdate,
    },
    user: { findUniqueOrThrow: userFindUniqueOrThrow, update: userUpdate },
    placementQuestion: { findMany: placementQuestionFindMany },
    placementAnswer: {
      findMany: placementAnswerFindMany,
      upsert: placementAnswerUpsert,
    },
    roadmap: {
      upsert: roadmapUpsert,
      findUnique: roadmapFindUnique,
      update: roadmapUpdate,
      updateMany: roadmapUpdateMany,
    },
    course: { findMany: courseFindMany },
    vocabLibrary: { findMany: vocabLibraryFindMany },
    listeningCategory: { findMany: listeningCategoryFindMany },
    speakingScenario: { findMany: speakingScenarioFindMany },
    lesson: { groupBy: lessonGroupBy },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  };

  const service = new PlacementService(
    prisma as never,
    roadmapAnalysis as never,
    roadmapPlanner as never,
  );
  return {
    service,
    prisma,
    attempt,
    user,
    placementAttemptFindFirst,
    placementAttemptCreate,
    placementAttemptUpdate,
    placementAttemptFindUniqueOrThrow,
    userFindUniqueOrThrow,
    userUpdate,
    placementQuestionFindMany,
    placementAnswerFindMany,
    placementAnswerUpsert,
    roadmapUpsert,
    roadmapFindUnique,
    roadmapUpdate,
    roadmapUpdateMany,
    courseFindMany,
    vocabLibraryFindMany,
    listeningCategoryFindMany,
    speakingScenarioFindMany,
    lessonGroupBy,
    roadmapAnalysisGenerate,
    roadmapPlannerPlan,
  };
};

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(NOW);
});
afterEach(() => {
  jest.useRealTimers();
});

describe('PlacementService.answer', () => {
  it('404s when the attempt does not belong to the caller', async () => {
    const { service, placementAttemptFindFirst } = buildHarness();
    placementAttemptFindFirst.mockResolvedValueOnce(null as never);
    await expect(
      service.answer('user-1', 'attempt-1', {
        questionId: 'g1',
        submitted: {},
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('409s once the attempt is already completed', async () => {
    const { service } = buildHarness({ completedAt: new Date() });
    await expect(
      service.answer('user-1', 'attempt-1', {
        questionId: 'g1',
        submitted: {},
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('409s once now is past expiresAt — the client never got to click submit in time', async () => {
    const { service } = buildHarness({
      expiresAt: new Date(NOW.getTime() - 1),
    });
    await expect(
      service.answer('user-1', 'attempt-1', {
        questionId: 'g1',
        submitted: {},
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('400s for a questionId that is not part of this attempt', async () => {
    const { service } = buildHarness();
    await expect(
      service.answer('user-1', 'attempt-1', {
        questionId: 'not-in-attempt',
        submitted: {},
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('upserts the answer, scoped by (attemptId, questionId), when everything is valid', async () => {
    const { service, placementAnswerUpsert } = buildHarness();
    await service.answer('user-1', 'attempt-1', {
      questionId: 'g1',
      submitted: { value: true },
    });
    expect(placementAnswerUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          attemptId_questionId: { attemptId: 'attempt-1', questionId: 'g1' },
        },
      }),
    );
  });
});

describe('PlacementService.getAttempt', () => {
  it('404s when there is no in-progress attempt', async () => {
    const { service, placementAttemptFindFirst } = buildHarness();
    placementAttemptFindFirst.mockResolvedValueOnce(null as never);
    await expect(service.getAttempt('user-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('returns the attempt state, unmutated, when still within expiresAt', async () => {
    const { service, placementAttemptUpdate } = buildHarness();
    const result = await service.getAttempt('user-1');
    expect(result.attemptId).toBe('attempt-1');
    expect(placementAttemptUpdate).not.toHaveBeenCalled();
  });

  it('lazily finalizes an expired, never-submitted attempt and then reports 404 (no longer in-progress)', async () => {
    const { service, placementAttemptUpdate, roadmapUpsert, userUpdate } =
      buildHarness({
        expiresAt: new Date(NOW.getTime() - 1),
      });
    await expect(service.getAttempt('user-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(placementAttemptUpdate).toHaveBeenCalledTimes(1);
    expect(placementAttemptUpdate.mock.calls[0][0].data.completedAt).toEqual(
      NOW,
    );
    expect(roadmapUpsert).toHaveBeenCalledTimes(1);
    // onboardedAt was null -> this finalize is what sets it.
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { onboardedAt: NOW } }),
    );
  });

  it('unanswered questions score as incorrect: an expired attempt with zero PlacementAnswer rows finalizes to 0', async () => {
    const { service, placementAttemptUpdate } = buildHarness({
      expiresAt: new Date(NOW.getTime() - 1),
    });
    await expect(service.getAttempt('user-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    const data = placementAttemptUpdate.mock.calls[0][0].data;
    expect(data.grammarScore).toBe(0);
    expect(data.vocabularyScore).toBe(0);
    expect(data.listeningScore).toBe(0);
    expect(data.overallScore).toBe(0);
  });

  it('does NOT touch onboardedAt again once it is already set', async () => {
    const { service, userUpdate } = buildHarness(
      { expiresAt: new Date(NOW.getTime() - 1) },
      { onboardedAt: new Date('2020-01-01') },
    );
    await expect(service.getAttempt('user-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(userUpdate).not.toHaveBeenCalled();
  });
});

describe('PlacementService.submit', () => {
  it('404s when the attempt does not belong to the caller', async () => {
    const { service, placementAttemptFindFirst } = buildHarness();
    placementAttemptFindFirst.mockResolvedValueOnce(null as never);
    await expect(service.submit('user-1', 'attempt-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('grades an on-time submit even though expiresAt has not passed yet', async () => {
    const { service, placementAttemptUpdate } = buildHarness(); // 4 min remaining
    const result = await service.submit('user-1', 'attempt-1');
    expect(result.completedAt).toBe(NOW.toISOString());
    expect(placementAttemptUpdate).toHaveBeenCalledTimes(1);
  });

  // Regression guard for the ResultStep bug: the DTO must carry authoritative
  // per-section counts, not just the rounded percentage — a client re-deriving
  // "X of Y correct" from a rounded score breaks the moment a section has more
  // than 4 questions (see placement-scoring.ts's own comment). 5/8 answered
  // correctly in GRAMMAR must come back as grammarScore: 63 (not a 25%-multiple)
  // AND grammarCorrect: 5, grammarTotal: 8 — both derived from the SAME
  // 8-question fixture the harness already seeds (g1-g8).
  it('returns authoritative per-section correct/total counts alongside the rounded score (5/8 -> 63%)', async () => {
    const { service, placementAnswerFindMany } = buildHarness();
    const fiveCorrectGrammarAnswers = ['g1', 'g2', 'g3', 'g4', 'g5'].map((questionId) => ({
      questionId,
      submitted: { value: true },
    }));
    // finalizeNow and toResultDto each re-fetch answers independently (see
    // toResultDto's own comment) — both calls must see the same data.
    placementAnswerFindMany.mockResolvedValue(fiveCorrectGrammarAnswers as never);

    const result = await service.submit('user-1', 'attempt-1');

    expect(result.grammarScore).toBe(63); // 5/8 = 62.5%, rounds to 63
    expect(result.grammarCorrect).toBe(5);
    expect(result.grammarTotal).toBe(8);
    expect(result.vocabularyCorrect).toBe(0);
    expect(result.vocabularyTotal).toBe(8);
  });

  it('replays the stored result for an already-completed attempt — never finalizes twice', async () => {
    const { service, placementAttemptUpdate, roadmapUpsert } = buildHarness({
      completedAt: new Date('2026-08-11T09:59:00.000Z'),
      grammarScore: 50,
      vocabularyScore: 50,
      listeningScore: 50,
      overallScore: 50,
      estimatedLevel: 'B1',
      durationSeconds: 120,
    });
    const result = await service.submit('user-1', 'attempt-1');
    expect(result.overallScore).toBe(50);
    expect(placementAttemptUpdate).not.toHaveBeenCalled();
    expect(roadmapUpsert).not.toHaveBeenCalled();
  });

  // Phase 7 — a retake regenerates the Roadmap row (the `update` branch of
  // the upsert, since the user already has one from before). Any AI summary
  // OR AI-planned selection cached against the OLD items/estimatedLevel must
  // not survive: it would sit on the dashboard describing a plan that is no
  // longer the plan.
  it('a retake clears any stale cached aiSummary and aiPlanning fields on the regenerated roadmap', async () => {
    const { service, roadmapUpsert } = buildHarness();
    await service.submit('user-1', 'attempt-1');
    expect(roadmapUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          aiSummary: null,
          aiSummaryAt: null,
          aiSummaryModel: null,
          aiPlanningModel: null,
          aiPlanningUsedAt: null,
        }),
      }),
    );
  });

  it("persists levelSource: 'TEST_GRADED' on the graded path", async () => {
    const { service, roadmapUpsert } = buildHarness();
    await service.submit('user-1', 'attempt-1');
    expect(roadmapUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ levelSource: 'TEST_GRADED' }),
      }),
    );
  });
});

describe('PlacementService.getAttemptReview', () => {
  it('404s when the attempt does not belong to the caller', async () => {
    const { service, placementAttemptFindFirst } = buildHarness();
    placementAttemptFindFirst.mockResolvedValueOnce(null as never);
    await expect(
      service.getAttemptReview('user-1', 'attempt-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  // Invariant 9 still applies while the attempt is in progress — a review
  // must not become a side-door to the answer key mid-test.
  it('rejects with a conflict while the attempt is still in progress', async () => {
    const { service } = buildHarness({ completedAt: null });
    await expect(
      service.getAttemptReview('user-1', 'attempt-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('re-derives correctness per question — correct, incorrect, and unanswered — since PlacementAnswer stores no isCorrect column', async () => {
    const { service, placementAnswerFindMany } = buildHarness({
      completedAt: new Date('2026-08-11T09:59:00.000Z'),
    });
    placementAnswerFindMany.mockResolvedValueOnce([
      { questionId: 'g1', submitted: { value: true } }, // matches correctAnswer -> correct
      { questionId: 'g2', submitted: { value: false } }, // does not match -> incorrect
      // g3 onward: no PlacementAnswer row at all -> unanswered
    ] as never);

    const review = await service.getAttemptReview('user-1', 'attempt-1');

    expect(review.attemptId).toBe('attempt-1');
    // Ordered by the attempt's own questionIds — the order the student
    // actually saw them in — never DB/insertion order.
    expect(review.items.map((i) => i.questionId)).toEqual([
      'g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7', 'g8',
      'v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8',
      'l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7', 'l8',
    ]);

    const g1 = review.items.find((i) => i.questionId === 'g1')!;
    expect(g1.submitted).toEqual({ value: true });
    expect(g1.isCorrect).toBe(true);
    // correctAnswer/explanation ARE disclosed here — deliberately, since
    // this endpoint only exists for an already-completed attempt.
    expect(g1.correctAnswer).toEqual({ value: true });

    const g2 = review.items.find((i) => i.questionId === 'g2')!;
    expect(g2.isCorrect).toBe(false);

    const g3 = review.items.find((i) => i.questionId === 'g3')!;
    expect(g3.submitted).toBeNull();
    expect(g3.isCorrect).toBe(false);
  });

  it('drops a questionId whose PlacementQuestion row no longer exists, rather than throwing', async () => {
    const { service, placementQuestionFindMany } = buildHarness({
      completedAt: new Date('2026-08-11T09:59:00.000Z'),
    });
    placementQuestionFindMany.mockImplementationOnce(() => Promise.resolve([] as never));

    const review = await service.getAttemptReview('user-1', 'attempt-1');

    expect(review.items).toHaveLength(0);
  });
});

describe('PlacementService.startBeginner', () => {
  // Phase 7 — the same staleness fix as submit's, on the OTHER code path
  // that can regenerate an existing Roadmap (the beginner-skip retake). Also
  // covers the new AI-planning cache fields, added alongside aiSummary*.
  it('regenerating via a retake clears any stale cached aiSummary and aiPlanning fields', async () => {
    const { service, roadmapUpsert } = buildHarness();
    await service.startBeginner('user-1');
    expect(roadmapUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          aiSummary: null,
          aiSummaryAt: null,
          aiSummaryModel: null,
          aiPlanningModel: null,
          aiPlanningUsedAt: null,
        }),
      }),
    );
  });

  // "Start from beginner" is an ASSUMED baseline, not a measured one — but
  // it must still be a real, non-null CefrLevel (not the old null) so the
  // roadmap algorithm can use level-aware selection instead of blindly
  // defaulting to the oldest course. levelSource is what tells downstream
  // consumers (buildReason, the consolidation phase, requestRoadmapAnalysis)
  // that this isn't backed by real section scores.
  it("persists estimatedLevel: 'A1' and levelSource: 'BEGINNER_ASSUMED' — never a blind null default", async () => {
    const { service, roadmapUpsert } = buildHarness();
    await service.startBeginner('user-1');
    expect(roadmapUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          estimatedLevel: 'A1',
          levelSource: 'BEGINNER_ASSUMED',
        }),
      }),
    );
  });

  it("loads candidates through loadAvailableResources, across all 3 pillar tables, with the caller's own goal", async () => {
    const { service, courseFindMany, vocabLibraryFindMany, listeningCategoryFindMany } =
      buildHarness({}, { learningGoal: 'FOUNDATION' });
    await service.startBeginner('user-1');
    const goalFilter = {
      OR: [
        { suitableGoals: { isEmpty: true } },
        { suitableGoals: { has: 'FOUNDATION' } },
      ],
    };
    expect(courseFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isPublished: true, type: 'GRAMMAR', ...goalFilter }),
      }),
    );
    expect(vocabLibraryFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ isPublished: true, ...goalFilter }) }),
    );
    expect(listeningCategoryFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ isPublished: true, ...goalFilter }) }),
    );
  });

  // Speaking is a fourth, OPTIONAL source with FAIL-CLOSED semantics,
  // deliberately the opposite of the other three tables above: it is never
  // queried at all for a goal other than GENERAL_ENGLISH, and even then
  // requires an explicit suitableGoals match (no isEmpty-means-eligible-
  // for-all fallback) — an untagged scenario must never leak into anyone's
  // roadmap. See loadAvailableResources' own header comment.
  it('never queries SpeakingScenario for a non-GENERAL_ENGLISH goal', async () => {
    const { service, speakingScenarioFindMany } = buildHarness(
      {},
      { learningGoal: 'FOUNDATION' },
    );
    await service.startBeginner('user-1');
    expect(speakingScenarioFindMany).not.toHaveBeenCalled();
  });

  it('queries SpeakingScenario fail-closed (isFreeTalk + explicit suitableGoals has, no isEmpty fallback) for GENERAL_ENGLISH', async () => {
    const { service, speakingScenarioFindMany } = buildHarness(
      {},
      { learningGoal: 'GENERAL_ENGLISH' },
    );
    await service.startBeginner('user-1');
    expect(speakingScenarioFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          isPublished: true,
          isFreeTalk: true,
          suitableGoals: { has: 'GENERAL_ENGLISH' },
        }),
      }),
    );
    // Never the isEmpty-means-eligible-for-all pattern the other 3 tables use.
    const call = speakingScenarioFindMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(call.where.OR).toBeUndefined();
  });

  // THE regression guard for the reported bug: goal=FOUNDATION + "start from
  // beginner" must land on the level-appropriate course, not whichever one
  // happens to be oldest. Mirrors the live catalog shape at the time the bug
  // was found — an older, higher-level (TOEIC-track) course and a newer,
  // A1-leveled foundation course, both type GRAMMAR, both eligible for
  // FOUNDATION (untagged or tagged either way doesn't matter here — the
  // point is level-aware selection, not goal filtering, which is a separate
  // concern already covered by the test above).
  it('goal=FOUNDATION + start-from-beginner picks the level-appropriate foundation course, not the older higher-level one', async () => {
    const { service, courseFindMany, roadmapUpsert } = buildHarness(
      {},
      { learningGoal: 'FOUNDATION' },
    );
    courseFindMany.mockResolvedValueOnce([
      {
        id: 'toeic-grammar',
        level: 'B1',
        createdAt: new Date('2026-07-17'),
        title: 'Trọng Tâm Ngữ Pháp TOEIC Part 5 & 6',
        description: '',
        suitableGoals: ['TOEIC_450', 'TOEIC_650', 'TOEIC_800'],
      },
      {
        id: 'foundation-grammar',
        level: 'A1',
        createdAt: new Date('2026-07-26'),
        title: 'Ngữ pháp cơ bản',
        description: '',
        suitableGoals: ['FOUNDATION', 'GENERAL_ENGLISH', 'REGULAR_PRACTICE'],
      },
    ] as never);

    await service.startBeginner('user-1');

    const persisted = roadmapUpsert.mock.calls[0][0].create as {
      items: Array<{ resourceId: string }>;
    };
    expect(persisted.items[0].resourceId).toBe('foundation-grammar');
  });
});

describe('PlacementService.start', () => {
  it('throws when the caller has not set a learning goal yet', async () => {
    const { service, placementAttemptFindFirst, userFindUniqueOrThrow } =
      buildHarness();
    placementAttemptFindFirst.mockResolvedValueOnce(null as never);
    userFindUniqueOrThrow.mockResolvedValueOnce({
      learningGoal: null,
    } as never);
    await expect(service.start('user-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('returns the existing in-progress attempt UNCHANGED — refresh never resets the timer', async () => {
    const { service, placementAttemptCreate, attempt } = buildHarness();
    const result = await service.start('user-1');
    expect(result.attemptId).toBe('attempt-1');
    expect(result.expiresAt).toBe(attempt.expiresAt.toISOString());
    expect(placementAttemptCreate).not.toHaveBeenCalled();
  });

  it('mints a fresh attempt once the previous one is past expiresAt (a retake)', async () => {
    const { service, placementAttemptCreate, placementAttemptUpdate } =
      buildHarness({
        expiresAt: new Date(NOW.getTime() - 1),
      });
    const result = await service.start('user-1');
    expect(placementAttemptUpdate).toHaveBeenCalledTimes(1); // the lazy finalize of the old one
    expect(placementAttemptCreate).toHaveBeenCalledTimes(1);
    expect(result.attemptId).toBe('attempt-2');
  });

  it('503s (PLACEMENT_BANK_INCOMPLETE) when the published bank cannot fill a bucket', async () => {
    const { service, placementAttemptFindFirst, placementQuestionFindMany } =
      buildHarness();
    placementAttemptFindFirst.mockResolvedValueOnce(null as never);
    placementQuestionFindMany.mockResolvedValueOnce([] as never); // empty bank
    await expect(service.start('user-1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});

describe('PlacementService.getRoadmap', () => {
  it('404s when the caller has no roadmap yet', async () => {
    const { service } = buildHarness(); // roadmapFindUnique defaults to null
    await expect(service.getRoadmap('user-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('joins items against LIVE Course/VocabLibrary/ListeningCategory rows — never the stored snapshot', async () => {
    const { service, roadmapFindUnique, courseFindMany, vocabLibraryFindMany, listeningCategoryFindMany } =
      buildHarness();
    roadmapFindUnique.mockResolvedValueOnce({
      goal: 'TOEIC_450',
      estimatedLevel: 'B1',
      placementAttemptId: 'attempt-1',
      generatedAt: NOW,
      aiSummary: null,
      items: [
        {
          phase: 1,
          pillar: 'VOCABULARY',
          resourceType: 'VOCAB_LIBRARY',
          resourceId: 'v1',
          reason: 'Phần yếu nhất (25%) — nên học trước.',
        },
      ],
    } as never);
    vocabLibraryFindMany.mockResolvedValueOnce([
      { id: 'v1', name: 'Live Library Title', thumbnail: 'thumb.png' },
    ] as never);

    const result = await service.getRoadmap('user-1');
    expect(result.items).toHaveLength(1);
    expect(result.items[0].resourceTitle).toBe('Live Library Title');
    expect(result.items[0].resourceThumbnail).toBe('thumb.png');
    // Only published resources are ever queried for the join.
    expect(courseFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ isPublished: true }) }),
    );
    expect(vocabLibraryFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ isPublished: true }) }),
    );
    expect(listeningCategoryFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ isPublished: true }) }),
    );
  });

  it('drops an item whose resource has since been unpublished or deleted — never serves it stale', async () => {
    const { service, roadmapFindUnique, courseFindMany } = buildHarness();
    roadmapFindUnique.mockResolvedValueOnce({
      goal: 'TOEIC_450',
      estimatedLevel: 'B1',
      placementAttemptId: 'attempt-1',
      generatedAt: NOW,
      aiSummary: null,
      items: [
        {
          phase: 1,
          pillar: 'GRAMMAR',
          resourceType: 'COURSE',
          resourceId: 'still-published',
          reason: 'x',
        },
        {
          phase: 2,
          pillar: 'GRAMMAR',
          resourceType: 'COURSE',
          resourceId: 'now-unpublished',
          reason: 'y',
        },
      ],
    } as never);
    // The unpublished course is simply absent from the (isPublished: true)
    // query result — same as if it had been deleted entirely.
    courseFindMany.mockResolvedValueOnce([
      { id: 'still-published', title: 'Still here', thumbnail: null },
    ] as never);

    const result = await service.getRoadmap('user-1');
    expect(result.items).toHaveLength(1);
    expect(result.items[0].resourceId).toBe('still-published');
  });

  it('includes totalEstimatedMinutes per course, from the shared estimated-minutes helper — always 0 for VocabLibrary/ListeningCategory items', async () => {
    const { service, roadmapFindUnique, courseFindMany, vocabLibraryFindMany, lessonGroupBy } =
      buildHarness();
    roadmapFindUnique.mockResolvedValueOnce({
      goal: 'TOEIC_450',
      estimatedLevel: 'B1',
      placementAttemptId: 'attempt-1',
      generatedAt: NOW,
      aiSummary: null,
      items: [
        { phase: 1, pillar: 'GRAMMAR', resourceType: 'COURSE', resourceId: 'c1', reason: 'x' },
        { phase: 2, pillar: 'VOCABULARY', resourceType: 'VOCAB_LIBRARY', resourceId: 'v1', reason: 'y' },
      ],
    } as never);
    courseFindMany.mockResolvedValueOnce([
      { id: 'c1', title: 'Course One', thumbnail: null },
    ] as never);
    vocabLibraryFindMany.mockResolvedValueOnce([
      { id: 'v1', name: 'Library One', thumbnail: null },
    ] as never);
    lessonGroupBy.mockResolvedValueOnce([
      { courseId: 'c1', _sum: { estimatedStudyMinutes: 240 } },
    ] as never);

    const result = await service.getRoadmap('user-1');

    expect(result.items.find((i) => i.resourceId === 'c1')?.totalEstimatedMinutes).toBe(240);
    expect(result.items.find((i) => i.resourceId === 'v1')?.totalEstimatedMinutes).toBe(0);
  });

  it('surfaces aiSummary verbatim (null until AI planning populates it)', async () => {
    const { service, roadmapFindUnique, courseFindMany } = buildHarness();
    roadmapFindUnique.mockResolvedValueOnce({
      goal: 'FOUNDATION',
      estimatedLevel: null,
      placementAttemptId: null,
      generatedAt: NOW,
      aiSummary: null,
      items: [],
    } as never);
    courseFindMany.mockResolvedValueOnce([] as never);
    const result = await service.getRoadmap('user-1');
    expect(result.aiSummary).toBeNull();
    expect(result.placementAttemptId).toBeNull();
  });

  // Legacy compat — a pre-multi-pillar Roadmap row persisted items in the
  // OLD Course-only shape ({phase, courseType, courseId, reason}). It must
  // keep reading correctly forever via normalizeRoadmapItem, never require a
  // backfill migration.
  it('reads an old-shape (courseType/courseId) persisted row correctly via the legacy-compat reader', async () => {
    const { service, roadmapFindUnique, courseFindMany } = buildHarness();
    roadmapFindUnique.mockResolvedValueOnce({
      goal: 'TOEIC_450',
      estimatedLevel: 'B1',
      placementAttemptId: 'attempt-1',
      generatedAt: NOW,
      aiSummary: null,
      items: [
        { phase: 1, courseType: 'GRAMMAR', courseId: 'c1', reason: 'Old-shape reason.' },
      ],
    } as never);
    courseFindMany.mockResolvedValueOnce([
      { id: 'c1', title: 'Legacy Course', thumbnail: null },
    ] as never);

    const result = await service.getRoadmap('user-1');

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      pillar: 'GRAMMAR',
      resourceType: 'COURSE',
      resourceId: 'c1',
      resourceTitle: 'Legacy Course',
      reason: 'Old-shape reason.',
    });
  });
});

describe('PlacementService.requestRoadmapAnalysis', () => {
  it('404s when the caller has no roadmap yet', async () => {
    const { service } = buildHarness(); // roadmapFindUnique defaults to null
    await expect(
      service.requestRoadmapAnalysis('user-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns the cached narrative WITHOUT calling the provider again', async () => {
    const { service, roadmapFindUnique, roadmapAnalysisGenerate } =
      buildHarness();
    roadmapFindUnique.mockResolvedValueOnce({
      id: 'roadmap-1',
      goal: 'FOUNDATION',
      estimatedLevel: null,
      placementAttemptId: null,
      items: [],
      aiSummary: 'Already narrated.',
      aiSummaryAt: NOW,
      aiSummaryModel: 'stored-model',
    } as never);

    const result = await service.requestRoadmapAnalysis('user-1');
    expect(result).toEqual({
      summary: 'Already narrated.',
      generatedAt: NOW.toISOString(),
      model: 'stored-model',
      cached: true,
    });
    expect(roadmapAnalysisGenerate).not.toHaveBeenCalled();
  });

  it('on the beginner-skip path (no attempt), generates with sectionScores: null and persists the result', async () => {
    const {
      service,
      roadmapFindUnique,
      courseFindMany,
      roadmapAnalysisGenerate,
      roadmapUpdate,
    } = buildHarness();
    roadmapFindUnique.mockResolvedValueOnce({
      id: 'roadmap-1',
      goal: 'GENERAL_ENGLISH',
      estimatedLevel: null,
      placementAttemptId: null,
      items: [
        {
          phase: 1,
          courseType: 'GRAMMAR',
          courseId: 'c1',
          reason: 'Start here.',
        },
        {
          phase: 2,
          courseType: 'VOCABULARY',
          courseId: 'now-gone',
          reason: 'Then here.',
        },
      ],
      aiSummary: null,
      aiSummaryAt: null,
      aiSummaryModel: null,
    } as never);
    // Only 'c1' is still live — 'now-gone' must be dropped from what the
    // provider is told about, same discipline getRoadmap already applies.
    courseFindMany.mockResolvedValueOnce([
      { id: 'c1', title: 'Grammar Basics', thumbnail: null },
    ] as never);

    const result = await service.requestRoadmapAnalysis('user-1');

    expect(roadmapAnalysisGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        goal: 'GENERAL_ENGLISH',
        estimatedLevel: null,
        sectionScores: null,
        phases: [
          {
            phase: 1,
            courseType: 'GRAMMAR',
            courseTitle: 'Grammar Basics',
            reason: 'Start here.',
          },
        ],
      }),
    );
    expect(result).toEqual({
      summary: 'A generated orientation paragraph.',
      generatedAt: NOW.toISOString(),
      model: 'fake-roadmap-model',
      cached: false,
    });
    expect(roadmapUpdate).toHaveBeenCalledWith({
      where: { id: 'roadmap-1' },
      data: {
        aiSummary: 'A generated orientation paragraph.',
        aiSummaryAt: NOW,
        aiSummaryModel: 'fake-roadmap-model',
      },
    });
  });

  it("on the graded path, loads the linked attempt's scores and passes them through", async () => {
    const {
      service,
      roadmapFindUnique,
      courseFindMany,
      placementAttemptFindUniqueOrThrow,
      roadmapAnalysisGenerate,
    } = buildHarness({
      grammarScore: 75,
      vocabularyScore: 50,
      listeningScore: 25,
    });
    roadmapFindUnique.mockResolvedValueOnce({
      id: 'roadmap-1',
      goal: 'TOEIC_450',
      estimatedLevel: 'B1',
      placementAttemptId: 'attempt-1',
      items: [],
      aiSummary: null,
      aiSummaryAt: null,
      aiSummaryModel: null,
    } as never);
    courseFindMany.mockResolvedValueOnce([] as never);

    await service.requestRoadmapAnalysis('user-1');

    expect(placementAttemptFindUniqueOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'attempt-1' } }),
    );
    expect(roadmapAnalysisGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        sectionScores: { grammar: 75, vocabulary: 50, listening: 25 },
      }),
    );
  });

  it('maps a provider timeout to a 503 with timeout-specific copy', async () => {
    const { service, roadmapFindUnique, roadmapAnalysisGenerate } =
      buildHarness();
    roadmapFindUnique.mockResolvedValueOnce({
      id: 'roadmap-1',
      goal: 'FOUNDATION',
      estimatedLevel: null,
      placementAttemptId: null,
      items: [],
      aiSummary: null,
      aiSummaryAt: null,
      aiSummaryModel: null,
    } as never);
    roadmapAnalysisGenerate.mockRejectedValueOnce(
      new RoadmapAnalysisError('TIMEOUT', 'AI roadmap analysis timed out'),
    );

    await expect(
      service.requestRoadmapAnalysis('user-1'),
    ).rejects.toMatchObject({
      status: 503,
      message: expect.stringMatching(/timed out/i),
    });
  });

  it('maps a provider outage to a 503, and never writes a partial cache entry', async () => {
    const {
      service,
      roadmapFindUnique,
      roadmapAnalysisGenerate,
      roadmapUpdate,
    } = buildHarness();
    roadmapFindUnique.mockResolvedValueOnce({
      id: 'roadmap-1',
      goal: 'FOUNDATION',
      estimatedLevel: null,
      placementAttemptId: null,
      items: [],
      aiSummary: null,
      aiSummaryAt: null,
      aiSummaryModel: null,
    } as never);
    roadmapAnalysisGenerate.mockRejectedValueOnce(
      new RoadmapAnalysisError(
        'UNAVAILABLE',
        'AI roadmap analysis is unavailable',
      ),
    );

    await expect(
      service.requestRoadmapAnalysis('user-1'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(roadmapUpdate).not.toHaveBeenCalled();
  });
});

describe('PlacementService.requestRoadmapPlan', () => {
  const GENERATED_AT = new Date('2026-08-11T09:00:00.000Z');

  // requestRoadmapPlan reads the roadmap once itself, then calls getRoadmap
  // internally at the end — every test needs BOTH resolved values queued,
  // same chaining pattern getStatus's own two-read test already uses.
  // aiPlanningUsedAt: null by default — the idempotency gate must stay OPEN
  // for the general success/failure-path tests below; tests exercising the
  // gate itself override it explicitly.
  const queueRoadmapReads = (
    roadmapFindUnique: ReturnType<typeof buildHarness>['roadmapFindUnique'],
    planFields: Record<string, unknown>,
    finalFields: Record<string, unknown>,
  ) => {
    roadmapFindUnique.mockResolvedValueOnce({
      goal: 'FOUNDATION',
      estimatedLevel: 'A1',
      levelSource: 'BEGINNER_ASSUMED',
      placementAttemptId: null,
      generatedAt: GENERATED_AT,
      aiPlanningUsedAt: null,
      ...planFields,
    } as never);
    roadmapFindUnique.mockResolvedValueOnce({
      goal: 'FOUNDATION',
      estimatedLevel: 'A1',
      levelSource: 'BEGINNER_ASSUMED',
      placementAttemptId: null,
      generatedAt: GENERATED_AT,
      aiSummary: null,
      aiPlanningModel: null,
      items: [],
      ...finalFields,
    } as never);
  };

  // The RAW Course row shape loadAvailableResources selects from Prisma
  // (no `type` field — that's now filtered at the query level and hardcoded
  // in the mapping, not read from the row).
  const CANDIDATE_ROW = {
    id: 'foundation-grammar',
    level: 'A1',
    createdAt: new Date('2024-01-01'),
    title: 'Ngữ pháp cơ bản',
    description: 'Basic grammar.',
    suitableGoals: [],
  };

  it('404s when the caller has no roadmap yet', async () => {
    const { service } = buildHarness(); // roadmapFindUnique defaults to null
    await expect(service.requestRoadmapPlan('user-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('a legacy row with no levelSource is returned as-is, without calling the planner', async () => {
    const { service, roadmapFindUnique, roadmapPlannerPlan, courseFindMany } =
      buildHarness();
    roadmapFindUnique.mockResolvedValueOnce({
      goal: 'FOUNDATION',
      estimatedLevel: null,
      levelSource: null,
      placementAttemptId: null,
      generatedAt: GENERATED_AT,
    } as never);
    roadmapFindUnique.mockResolvedValueOnce({
      goal: 'FOUNDATION',
      estimatedLevel: null,
      levelSource: null,
      placementAttemptId: null,
      generatedAt: GENERATED_AT,
      aiSummary: null,
      aiPlanningModel: null,
      items: [],
    } as never);
    courseFindMany.mockResolvedValueOnce([] as never);

    const result = await service.requestRoadmapPlan('user-1');

    expect(roadmapPlannerPlan).not.toHaveBeenCalled();
    expect(result.aiPlanningUsed).toBe(false);
  });

  it('on a valid AI selection, persists items AND aiSummary together, and reports aiPlanningUsed: true', async () => {
    const {
      service,
      roadmapFindUnique,
      roadmapPlannerPlan,
      roadmapUpdateMany,
      courseFindMany,
    } = buildHarness();
    queueRoadmapReads(
      roadmapFindUnique,
      {},
      {
        aiPlanningModel: 'fake-planner-model',
        aiSummary: 'Ưu tiên ngữ pháp trước vì phù hợp trình độ hiện tại.',
        items: [
          { phase: 1, pillar: 'GRAMMAR', resourceType: 'COURSE', resourceId: 'foundation-grammar', reason: 'Fits.' },
        ],
      },
    );
    // Called twice: once to build the AI prompt candidates, once to
    // re-validate against the latest catalog after Gemini responds.
    courseFindMany.mockResolvedValue([CANDIDATE_ROW] as never);
    roadmapPlannerPlan.mockResolvedValueOnce({
      phases: [{ resourceType: 'COURSE', resourceId: 'foundation-grammar', reason: 'Fits your level.' }],
      overallReason: 'Ưu tiên ngữ pháp trước vì phù hợp trình độ hiện tại.',
      model: 'fake-planner-model',
    });

    const result = await service.requestRoadmapPlan('user-1');

    expect(roadmapUpdateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', generatedAt: GENERATED_AT, aiPlanningUsedAt: null },
      data: expect.objectContaining({
        items: [
          { phase: 1, pillar: 'GRAMMAR', resourceType: 'COURSE', resourceId: 'foundation-grammar', reason: 'Fits your level.' },
        ],
        aiSummary: 'Ưu tiên ngữ pháp trước vì phù hợp trình độ hiện tại.',
        aiPlanningModel: 'fake-planner-model',
      }),
    });
    expect(result.aiPlanningUsed).toBe(true);
  });

  it('falls back to the deterministic roadmap, without throwing, when the AI returns a disallowed resourceId', async () => {
    const {
      service,
      roadmapFindUnique,
      roadmapPlannerPlan,
      roadmapUpdateMany,
      courseFindMany,
    } = buildHarness();
    queueRoadmapReads(roadmapFindUnique, {}, {});
    courseFindMany.mockResolvedValue([CANDIDATE_ROW] as never);
    roadmapPlannerPlan.mockResolvedValueOnce({
      phases: [{ resourceType: 'COURSE', resourceId: 'not-a-real-candidate', reason: 'x' }],
      overallReason: 'x',
    });

    const result = await service.requestRoadmapPlan('user-1');

    expect(roadmapUpdateMany).not.toHaveBeenCalled();
    expect(result.aiPlanningUsed).toBe(false);
  });

  it('discards the whole plan when the AI mislabels a real VOCAB_LIBRARY id as COURSE (composite-key allow-list)', async () => {
    const {
      service,
      roadmapFindUnique,
      roadmapPlannerPlan,
      roadmapUpdateMany,
      courseFindMany,
      vocabLibraryFindMany,
    } = buildHarness();
    queueRoadmapReads(roadmapFindUnique, {}, {});
    courseFindMany.mockResolvedValue([] as never);
    vocabLibraryFindMany.mockResolvedValue([
      { id: 'vocab-lib-1', level: 'A1', orderIndex: 0, name: '1000 Từ Tiếng Anh Thông Dụng', description: '', suitableGoals: [] },
    ] as never);
    roadmapPlannerPlan.mockResolvedValueOnce({
      phases: [{ resourceType: 'COURSE', resourceId: 'vocab-lib-1', reason: 'x' }],
      overallReason: 'y',
    });

    const result = await service.requestRoadmapPlan('user-1');

    expect(roadmapUpdateMany).not.toHaveBeenCalled();
    expect(result.aiPlanningUsed).toBe(false);
  });

  it('falls back to the deterministic roadmap, without throwing, when the provider is unavailable', async () => {
    const {
      service,
      roadmapFindUnique,
      roadmapPlannerPlan,
      roadmapUpdateMany,
      courseFindMany,
    } = buildHarness();
    queueRoadmapReads(roadmapFindUnique, {}, {});
    courseFindMany.mockResolvedValue([CANDIDATE_ROW] as never);
    roadmapPlannerPlan.mockRejectedValueOnce(
      new RoadmapPlanningError('UNAVAILABLE', 'AI roadmap planning is unavailable'),
    );

    await expect(service.requestRoadmapPlan('user-1')).resolves.toMatchObject({
      aiPlanningUsed: false,
    });
    expect(roadmapUpdateMany).not.toHaveBeenCalled();
  });

  // THE concurrency invariant (review finding C1): a retake committing while
  // Gemini is in flight must never have its fresh, correct roadmap
  // overwritten by a plan computed against the profile that existed before
  // the retake. Modeled here by roadmapUpdateMany reporting count: 0 — the
  // real Prisma call reports exactly that when the WHERE clause's
  // generatedAt no longer matches the row (see the where clause assertion).
  it('discards a valid AI plan when the roadmap changed underneath it (retake raced the Gemini call)', async () => {
    const {
      service,
      roadmapFindUnique,
      roadmapPlannerPlan,
      roadmapUpdateMany,
      courseFindMany,
    } = buildHarness();
    queueRoadmapReads(roadmapFindUnique, {}, {
      // The "already correct, fresher" roadmap the retake itself wrote —
      // this is what getRoadmap's own later read returns, proving the
      // AI-selected items from below never got persisted over it.
      items: [{ phase: 1, pillar: 'GRAMMAR', resourceType: 'COURSE', resourceId: 'retake-winner', reason: 'From the retake.' }],
    });
    // Includes 'retake-winner' too, so the final getRoadmap's join actually
    // keeps that item rather than silently dropping it as "unpublished" —
    // which would make the assertion below vacuously true on an empty array.
    courseFindMany.mockResolvedValue([
      CANDIDATE_ROW,
      {
        id: 'retake-winner',
        title: 'Retake Course',
        thumbnail: null,
        level: null,
        createdAt: new Date('2024-01-01'),
        description: '',
        suitableGoals: [],
      },
    ] as never);
    roadmapPlannerPlan.mockResolvedValueOnce({
      phases: [{ resourceType: 'COURSE', resourceId: 'foundation-grammar', reason: 'Stale — computed before the retake.' }],
      overallReason: 'Stale rationale.',
    });
    // Simulates Postgres reporting 0 rows matched: a retake already bumped
    // generatedAt past the snapshot this call captured.
    roadmapUpdateMany.mockResolvedValueOnce({ count: 0 } as never);

    const result = await service.requestRoadmapPlan('user-1');

    expect(roadmapUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1', generatedAt: GENERATED_AT, aiPlanningUsedAt: null },
      }),
    );
    // The retake's own, fresher item survives untouched...
    expect(result.items).toHaveLength(1);
    expect(result.items[0].resourceId).toBe('retake-winner');
    // ...and the stale AI plan's resourceId must NOT appear anywhere.
    expect(result.items.every((i) => i.resourceId !== 'foundation-grammar')).toBe(true);
    expect(result.aiPlanningUsed).toBe(false);
  });

  // Idempotency (backend-authoritative caching): a successful AI plan
  // already exists for this exact deterministic generation — a second call
  // (page refresh, back/forward, a React StrictMode double-invoke) must
  // short-circuit without re-calling the (paid) provider at all.
  it('short-circuits without calling the planner when a successful plan already exists for this generation', async () => {
    const { service, roadmapFindUnique, roadmapPlannerPlan } = buildHarness();
    roadmapFindUnique.mockResolvedValueOnce({
      goal: 'FOUNDATION',
      estimatedLevel: 'A1',
      levelSource: 'BEGINNER_ASSUMED',
      placementAttemptId: null,
      generatedAt: GENERATED_AT,
      aiPlanningUsedAt: NOW, // already planned successfully
    } as never);
    roadmapFindUnique.mockResolvedValueOnce({
      goal: 'FOUNDATION',
      estimatedLevel: 'A1',
      levelSource: 'BEGINNER_ASSUMED',
      placementAttemptId: null,
      generatedAt: GENERATED_AT,
      aiSummary: 'Already planned.',
      aiPlanningModel: 'fake-planner-model',
      items: [],
    } as never);

    const result = await service.requestRoadmapPlan('user-1');

    expect(roadmapPlannerPlan).not.toHaveBeenCalled();
    expect(result.aiSummary).toBe('Already planned.');
    expect(result.aiPlanningUsed).toBe(true);
  });

  // A FAILED attempt (provider error, invalid plan) must leave the gate open
  // — already exercised implicitly by the "disallowed resourceId" and
  // "provider unavailable" tests above (both call the planner because
  // aiPlanningUsedAt stays null by default in queueRoadmapReads). This test
  // makes that explicit: two consecutive failed calls both reach the
  // planner, neither short-circuits.
  it('a failed attempt leaves the gate open — a subsequent call retries the planner', async () => {
    const { service, roadmapFindUnique, roadmapPlannerPlan, courseFindMany } =
      buildHarness();
    queueRoadmapReads(roadmapFindUnique, {}, {});
    queueRoadmapReads(roadmapFindUnique, {}, {});
    courseFindMany.mockResolvedValue([CANDIDATE_ROW] as never);
    roadmapPlannerPlan.mockRejectedValue(
      new RoadmapPlanningError('UNAVAILABLE', 'AI roadmap planning is unavailable'),
    );

    await service.requestRoadmapPlan('user-1');
    await service.requestRoadmapPlan('user-1');

    expect(roadmapPlannerPlan).toHaveBeenCalledTimes(2);
  });

  // DB-level guard, not just the read-time short-circuit: if two calls for
  // the SAME generation both race past the read-time check (neither has
  // written when the other reads — a genuine concurrent double-invoke), the
  // conditional write's `aiPlanningUsedAt: null` clause ensures only the
  // first writer's result can persist. Modeled here via roadmapUpdateMany
  // reporting count:1 then count:0.
  it('a race between two calls for the same generation is guarded by the WHERE clause, not just the read-time check', async () => {
    const { service, roadmapFindUnique, roadmapPlannerPlan, roadmapUpdateMany, courseFindMany } =
      buildHarness();
    queueRoadmapReads(roadmapFindUnique, {}, { aiPlanningModel: 'fake-planner-model' });
    queueRoadmapReads(roadmapFindUnique, {}, { aiPlanningModel: 'fake-planner-model' });
    courseFindMany.mockResolvedValue([CANDIDATE_ROW] as never);
    roadmapPlannerPlan.mockResolvedValue({
      phases: [{ resourceType: 'COURSE', resourceId: 'foundation-grammar', reason: 'x' }],
      overallReason: 'y',
    });
    roadmapUpdateMany
      .mockResolvedValueOnce({ count: 1 } as never) // first writer wins
      .mockResolvedValueOnce({ count: 0 } as never); // second writer's condition no longer holds

    await service.requestRoadmapPlan('user-1');
    await service.requestRoadmapPlan('user-1');

    expect(roadmapPlannerPlan).toHaveBeenCalledTimes(2); // both raced past the read-time check
    expect(roadmapUpdateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ where: expect.objectContaining({ aiPlanningUsedAt: null }) }),
    );
    expect(roadmapUpdateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ where: expect.objectContaining({ aiPlanningUsedAt: null }) }),
    );
  });
});

describe('PlacementService.getStatus', () => {
  it('reports no in-progress attempt and no roadmap for a caller with only a goal set', async () => {
    const { service, placementAttemptFindFirst } = buildHarness();
    placementAttemptFindFirst.mockResolvedValueOnce(null as never);
    const result = await service.getStatus('user-1');
    expect(result).toEqual({
      onboarded: false,
      learningGoal: 'FOUNDATION',
      hasInProgressAttempt: false,
      attemptExpiresAt: null,
      hasRoadmap: false,
    });
  });

  it('reports the in-progress attempt UNCHANGED (no finalize) while still within expiresAt', async () => {
    const { service, attempt, placementAttemptUpdate } = buildHarness();
    const result = await service.getStatus('user-1');
    expect(result.hasInProgressAttempt).toBe(true);
    expect(result.attemptExpiresAt).toBe(attempt.expiresAt.toISOString());
    expect(placementAttemptUpdate).not.toHaveBeenCalled();
  });

  it('lazily finalizes an expired attempt and reports hasInProgressAttempt: false afterward', async () => {
    const { service, placementAttemptUpdate } = buildHarness({
      expiresAt: new Date(NOW.getTime() - 1),
    });
    const result = await service.getStatus('user-1');
    expect(result.hasInProgressAttempt).toBe(false);
    expect(result.attemptExpiresAt).toBeNull();
    expect(placementAttemptUpdate).toHaveBeenCalledTimes(1); // the lazy finalize actually ran
  });

  it('reflects the FRESH onboarded/roadmap state after a lazy finalize, not a pre-finalize snapshot', async () => {
    const { service, userFindUniqueOrThrow, roadmapFindUnique } = buildHarness({
      expiresAt: new Date(NOW.getTime() - 1),
    });
    // 1st call is INSIDE finalizeNow (checking whether onboardedAt is
    // already set, before deciding to include the User update in the
    // transaction) — still null, the pre-finalize truth.
    userFindUniqueOrThrow.mockResolvedValueOnce({
      onboardedAt: null,
      learningGoal: 'FOUNDATION',
    } as never);
    // 2nd call is getStatus's OWN read, issued AFTER finalize committed —
    // must see the just-set value, not the snapshot from the 1st call.
    userFindUniqueOrThrow.mockResolvedValueOnce({
      onboardedAt: NOW,
      learningGoal: 'FOUNDATION',
    } as never);
    roadmapFindUnique.mockResolvedValueOnce({ id: 'roadmap-1' } as never);

    const result = await service.getStatus('user-1');
    expect(result.onboarded).toBe(true);
    expect(result.hasRoadmap).toBe(true);
  });
});
