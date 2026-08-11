import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PlacementService } from './placement.service';

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
      'g1', 'g2', 'g3', 'g4',
      'v1', 'v2', 'v3', 'v4',
      'l1', 'l2', 'l3', 'l4',
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

  const placementAttemptFindFirst = jest.fn(() => Promise.resolve(attempt as never));
  const placementAttemptCreate = jest.fn((args: { data: Record<string, unknown> }) =>
    Promise.resolve({ ...attempt, id: 'attempt-2', completedAt: null, ...args.data } as never),
  );
  const placementAttemptUpdate = jest.fn((args: { data: Record<string, unknown> }) =>
    Promise.resolve({ ...attempt, ...args.data } as never),
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
  const roadmapUpsert = jest.fn((args: { create: unknown }) => Promise.resolve(args.create as never));
  const courseFindMany = jest.fn(() => Promise.resolve([] as never));

  const prisma = {
    placementAttempt: {
      findFirst: placementAttemptFindFirst,
      create: placementAttemptCreate,
      update: placementAttemptUpdate,
    },
    user: { findUniqueOrThrow: userFindUniqueOrThrow, update: userUpdate },
    placementQuestion: { findMany: placementQuestionFindMany },
    placementAnswer: { findMany: placementAnswerFindMany, upsert: placementAnswerUpsert },
    roadmap: { upsert: roadmapUpsert },
    course: { findMany: courseFindMany },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  };

  const service = new PlacementService(prisma as never);
  return {
    service,
    prisma,
    attempt,
    user,
    placementAttemptFindFirst,
    placementAttemptCreate,
    placementAttemptUpdate,
    userFindUniqueOrThrow,
    userUpdate,
    placementQuestionFindMany,
    placementAnswerFindMany,
    placementAnswerUpsert,
    roadmapUpsert,
    courseFindMany,
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
      service.answer('user-1', 'attempt-1', { questionId: 'g1', submitted: {} }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('409s once the attempt is already completed', async () => {
    const { service } = buildHarness({ completedAt: new Date() });
    await expect(
      service.answer('user-1', 'attempt-1', { questionId: 'g1', submitted: {} }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('409s once now is past expiresAt — the client never got to click submit in time', async () => {
    const { service } = buildHarness({ expiresAt: new Date(NOW.getTime() - 1) });
    await expect(
      service.answer('user-1', 'attempt-1', { questionId: 'g1', submitted: {} }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('400s for a questionId that is not part of this attempt', async () => {
    const { service } = buildHarness();
    await expect(
      service.answer('user-1', 'attempt-1', { questionId: 'not-in-attempt', submitted: {} }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('upserts the answer, scoped by (attemptId, questionId), when everything is valid', async () => {
    const { service, placementAnswerUpsert } = buildHarness();
    await service.answer('user-1', 'attempt-1', { questionId: 'g1', submitted: { value: true } });
    expect(placementAnswerUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { attemptId_questionId: { attemptId: 'attempt-1', questionId: 'g1' } },
      }),
    );
  });
});

describe('PlacementService.getAttempt', () => {
  it('404s when there is no in-progress attempt', async () => {
    const { service, placementAttemptFindFirst } = buildHarness();
    placementAttemptFindFirst.mockResolvedValueOnce(null as never);
    await expect(service.getAttempt('user-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns the attempt state, unmutated, when still within expiresAt', async () => {
    const { service, placementAttemptUpdate } = buildHarness();
    const result = await service.getAttempt('user-1');
    expect(result.attemptId).toBe('attempt-1');
    expect(placementAttemptUpdate).not.toHaveBeenCalled();
  });

  it('lazily finalizes an expired, never-submitted attempt and then reports 404 (no longer in-progress)', async () => {
    const { service, placementAttemptUpdate, roadmapUpsert, userUpdate } = buildHarness({
      expiresAt: new Date(NOW.getTime() - 1),
    });
    await expect(service.getAttempt('user-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(placementAttemptUpdate).toHaveBeenCalledTimes(1);
    expect(placementAttemptUpdate.mock.calls[0][0].data.completedAt).toEqual(NOW);
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
    await expect(service.getAttempt('user-1')).rejects.toBeInstanceOf(NotFoundException);
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
    await expect(service.getAttempt('user-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(userUpdate).not.toHaveBeenCalled();
  });
});

describe('PlacementService.submit', () => {
  it('404s when the attempt does not belong to the caller', async () => {
    const { service, placementAttemptFindFirst } = buildHarness();
    placementAttemptFindFirst.mockResolvedValueOnce(null as never);
    await expect(service.submit('user-1', 'attempt-1')).rejects.toBeInstanceOf(NotFoundException);
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
});

describe('PlacementService.start', () => {
  it('throws when the caller has not set a learning goal yet', async () => {
    const { service, placementAttemptFindFirst, userFindUniqueOrThrow } = buildHarness();
    placementAttemptFindFirst.mockResolvedValueOnce(null as never);
    userFindUniqueOrThrow.mockResolvedValueOnce({ learningGoal: null } as never);
    await expect(service.start('user-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns the existing in-progress attempt UNCHANGED — refresh never resets the timer', async () => {
    const { service, placementAttemptCreate, attempt } = buildHarness();
    const result = await service.start('user-1');
    expect(result.attemptId).toBe('attempt-1');
    expect(result.expiresAt).toBe(attempt.expiresAt.toISOString());
    expect(placementAttemptCreate).not.toHaveBeenCalled();
  });

  it('mints a fresh attempt once the previous one is past expiresAt (a retake)', async () => {
    const { service, placementAttemptCreate, placementAttemptUpdate } = buildHarness({
      expiresAt: new Date(NOW.getTime() - 1),
    });
    const result = await service.start('user-1');
    expect(placementAttemptUpdate).toHaveBeenCalledTimes(1); // the lazy finalize of the old one
    expect(placementAttemptCreate).toHaveBeenCalledTimes(1);
    expect(result.attemptId).toBe('attempt-2');
  });

  it('503s (PLACEMENT_BANK_INCOMPLETE) when the published bank cannot fill a bucket', async () => {
    const { service, placementAttemptFindFirst, placementQuestionFindMany } = buildHarness();
    placementAttemptFindFirst.mockResolvedValueOnce(null as never);
    placementQuestionFindMany.mockResolvedValueOnce([] as never); // empty bank
    await expect(service.start('user-1')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
