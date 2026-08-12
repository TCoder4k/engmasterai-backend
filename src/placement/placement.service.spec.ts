import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PlacementService } from './placement.service';
import { RoadmapAnalysisError } from './roadmap/roadmap-analysis.provider';

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
      'g1',
      'g2',
      'g3',
      'g4',
      'v1',
      'v2',
      'v3',
      'v4',
      'l1',
      'l2',
      'l3',
      'l4',
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

  // One row per bucket the fixed 12-question shape needs (2 EASY / 1 MEDIUM
  // / 1 HARD per section) — matches DIFFICULTY_REQUIREMENTS exactly, with no
  // slack, so sampleQuestionIds succeeds against this bank. Same ids as
  // attempt.questionIds above by construction.
  const questionDefs = [
    { id: 'g1', section: 'GRAMMAR', difficulty: 'EASY' },
    { id: 'g2', section: 'GRAMMAR', difficulty: 'EASY' },
    { id: 'g3', section: 'GRAMMAR', difficulty: 'MEDIUM' },
    { id: 'g4', section: 'GRAMMAR', difficulty: 'HARD' },
    { id: 'v1', section: 'VOCABULARY', difficulty: 'EASY' },
    { id: 'v2', section: 'VOCABULARY', difficulty: 'EASY' },
    { id: 'v3', section: 'VOCABULARY', difficulty: 'MEDIUM' },
    { id: 'v4', section: 'VOCABULARY', difficulty: 'HARD' },
    { id: 'l1', section: 'LISTENING', difficulty: 'EASY' },
    { id: 'l2', section: 'LISTENING', difficulty: 'EASY' },
    { id: 'l3', section: 'LISTENING', difficulty: 'MEDIUM' },
    { id: 'l4', section: 'LISTENING', difficulty: 'HARD' },
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
  const courseFindMany = jest.fn(() => Promise.resolve([] as never));
  // Backs getEstimatedMinutesByCourseId (shared/estimated-minutes.ts), called
  // by joinLiveCourses. Empty by default -> totalEstimatedMinutes falls back
  // to 0 for every course, same as CourseService's own `?? 0` convention.
  const lessonGroupBy = jest.fn(() => Promise.resolve([] as never));

  // Phase 6 — a fake RoadmapAnalysisProvider, the same DI-token seam
  // GeminiRoadmapAnalysisProvider sits behind in production (see
  // placement.module.ts). Directly controllable, unlike a real Gemini call.
  const roadmapAnalysisGenerate = jest.fn(() =>
    Promise.resolve({ summary: 'A generated orientation paragraph.' }),
  );
  const roadmapAnalysis = {
    model: 'fake-roadmap-model',
    generate: roadmapAnalysisGenerate,
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
    },
    course: { findMany: courseFindMany },
    lesson: { groupBy: lessonGroupBy },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  };

  const service = new PlacementService(
    prisma as never,
    roadmapAnalysis as never,
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
    courseFindMany,
    lessonGroupBy,
    roadmapAnalysisGenerate,
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
  // cached against the OLD items/estimatedLevel must not survive: it would
  // sit on the dashboard describing a plan that is no longer the plan.
  it('a retake clears any stale cached aiSummary on the regenerated roadmap', async () => {
    const { service, roadmapUpsert } = buildHarness();
    await service.submit('user-1', 'attempt-1');
    expect(roadmapUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          aiSummary: null,
          aiSummaryAt: null,
          aiSummaryModel: null,
        }),
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
      'g1', 'g2', 'g3', 'g4', 'v1', 'v2', 'v3', 'v4', 'l1', 'l2', 'l3', 'l4',
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
  // that can regenerate an existing Roadmap (the beginner-skip retake).
  it('regenerating via a retake clears any stale cached aiSummary', async () => {
    const { service, roadmapUpsert } = buildHarness();
    await service.startBeginner('user-1');
    expect(roadmapUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          aiSummary: null,
          aiSummaryAt: null,
          aiSummaryModel: null,
        }),
      }),
    );
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

  it('joins items against LIVE Course rows — never the stored snapshot', async () => {
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
          courseType: 'VOCABULARY',
          courseId: 'c1',
          reason: 'Weakest section (25%) — recommended first.',
        },
      ],
    } as never);
    courseFindMany.mockResolvedValueOnce([
      { id: 'c1', title: 'Live Course Title', thumbnail: 'thumb.png' },
    ] as never);

    const result = await service.getRoadmap('user-1');
    expect(result.items).toHaveLength(1);
    expect(result.items[0].courseTitle).toBe('Live Course Title');
    expect(result.items[0].courseThumbnail).toBe('thumb.png');
    // Only published courses are ever queried for the join.
    expect(courseFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isPublished: true }),
      }),
    );
  });

  it('drops an item whose course has since been unpublished or deleted — never serves it stale', async () => {
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
          courseType: 'VOCABULARY',
          courseId: 'still-published',
          reason: 'x',
        },
        {
          phase: 2,
          courseType: 'GRAMMAR',
          courseId: 'now-unpublished',
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
    expect(result.items[0].courseId).toBe('still-published');
  });

  it('includes totalEstimatedMinutes per course, from the shared estimated-minutes helper', async () => {
    const { service, roadmapFindUnique, courseFindMany, lessonGroupBy } =
      buildHarness();
    roadmapFindUnique.mockResolvedValueOnce({
      goal: 'TOEIC_450',
      estimatedLevel: 'B1',
      placementAttemptId: 'attempt-1',
      generatedAt: NOW,
      aiSummary: null,
      items: [
        { phase: 1, courseType: 'VOCABULARY', courseId: 'c1', reason: 'x' },
        { phase: 2, courseType: 'GRAMMAR', courseId: 'c2', reason: 'y' },
      ],
    } as never);
    courseFindMany.mockResolvedValueOnce([
      { id: 'c1', title: 'Course One', thumbnail: null },
      { id: 'c2', title: 'Course Two', thumbnail: null },
    ] as never);
    lessonGroupBy.mockResolvedValueOnce([
      { courseId: 'c1', _sum: { estimatedStudyMinutes: 240 } },
      // c2 has no matching group -> falls back to 0, not undefined/null.
    ] as never);

    const result = await service.getRoadmap('user-1');

    expect(result.items.find((i) => i.courseId === 'c1')?.totalEstimatedMinutes).toBe(240);
    expect(result.items.find((i) => i.courseId === 'c2')?.totalEstimatedMinutes).toBe(0);
  });

  it('surfaces aiSummary verbatim (null until Phase 6 populates it)', async () => {
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
