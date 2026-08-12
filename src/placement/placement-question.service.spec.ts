import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PlacementQuestionService } from './placement-question.service';

// Personalized Onboarding & Placement Test — the admin question bank
// service, against a mocked Prisma. Same technique as
// dashboard-analytics.service.spec.ts / course-progress.service.spec.ts: a
// plain object standing in for PrismaService, instantiated directly rather
// than through a Nest TestingModule (the constructor takes only Prisma).

const buildHarness = (overrides: Record<string, unknown> = {}) => {
  const found = {
    id: 'q1',
    section: 'GRAMMAR',
    type: 'MULTIPLE_CHOICE',
    difficulty: 'EASY',
    content: 'Choose the correct form',
    options: [
      { id: 'a', text: 'go' },
      { id: 'b', text: 'goes' },
    ],
    correctAnswer: { optionId: 'b' },
    explanation: null,
    audioUrl: null,
    imageUrl: null,
    isPublished: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };

  const create = jest.fn((args) => Promise.resolve({ id: 'new-id', ...args.data }));
  const update = jest.fn((args) => Promise.resolve({ id: args.where.id, ...args.data }));
  const findUnique = jest.fn(() => Promise.resolve(found));
  const deleteFn = jest.fn(() => Promise.resolve(found));
  const findMany = jest.fn(() => Promise.resolve([found]));
  const count = jest.fn(() => Promise.resolve(1));
  const groupBy = jest.fn(() => Promise.resolve([]));

  const prisma = {
    placementQuestion: {
      create,
      update,
      findUnique,
      delete: deleteFn,
      findMany,
      count,
      groupBy,
    },
  };

  const service = new PlacementQuestionService(prisma as never);
  return { service, prisma, found, create, update, findUnique, deleteFn, findMany, count, groupBy };
};

describe('PlacementQuestionService', () => {
  describe('create', () => {
    it('rejects a MULTIPLE_CHOICE question whose correctAnswer.optionId is not among its own options', async () => {
      const { service } = buildHarness();
      await expect(
        service.create({
          section: 'GRAMMAR',
          type: 'MULTIPLE_CHOICE',
          difficulty: 'EASY',
          content: 'x',
          options: [{ id: 'a', text: 'go' }, { id: 'b', text: 'goes' }],
          correctAnswer: { optionId: 'c' },
        } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('writes only the explicit, known fields — never spreads the DTO', async () => {
      const { service, create } = buildHarness();
      await service.create({
        section: 'VOCABULARY',
        type: 'TRUE_FALSE',
        difficulty: 'MEDIUM',
        content: 'Water boils at 100C',
        correctAnswer: { value: true },
        // An extra property a malicious/buggy client might attach. Never
        // reaching Prisma is the whole point of explicit construction.
        isPublished: true,
      } as never);

      const data = create.mock.calls[0][0].data;
      expect(Object.keys(data).sort()).toEqual(
        [
          'section',
          'type',
          'difficulty',
          'content',
          'options',
          'correctAnswer',
          'explanation',
          'audioUrl',
          'transcript',
          'imageUrl',
        ].sort(),
      );
      expect(data.isPublished).toBeUndefined();
    });
  });

  describe('update', () => {
    it('validates against the RESOLVED shape when a patch changes only correctAnswer', async () => {
      // found() has type MULTIPLE_CHOICE with options [a,b]; patch only
      // correctAnswer with an optionId that doesn't exist among them.
      const { service } = buildHarness();
      await expect(
        service.update('q1', { correctAnswer: { optionId: 'nope' } } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('accepts a correctAnswer patch that is valid against the existing options', async () => {
      const { service, update } = buildHarness();
      await service.update('q1', { correctAnswer: { optionId: 'a' } } as never);
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'q1' },
          data: { correctAnswer: { optionId: 'a' } },
        }),
      );
    });

    it('throws 404 for an unknown id', async () => {
      const { service, findUnique } = buildHarness();
      findUnique.mockResolvedValueOnce(null as never);
      await expect(service.update('missing', {} as never)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('publish/unpublish', () => {
    it('publish sets isPublished true and nothing else', async () => {
      const { service, update } = buildHarness();
      await service.publish('q1');
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'q1' }, data: { isPublished: true } }),
      );
    });

    it('unpublish sets isPublished false', async () => {
      const { service, update } = buildHarness();
      await service.unpublish('q1');
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'q1' }, data: { isPublished: false } }),
      );
    });
  });

  describe('remove', () => {
    it('deletes with no "in use" guard — PlacementAttempt.questionIds is a Json snapshot, not an FK', async () => {
      const { service, deleteFn } = buildHarness();
      await service.remove('q1');
      expect(deleteFn).toHaveBeenCalledWith({ where: { id: 'q1' } });
    });
  });

  describe('getCoverage', () => {
    it('reports every (section, difficulty) bucket as insufficient when the bank is empty', async () => {
      const { service } = buildHarness();
      const result = await service.getCoverage();
      expect(result.ready).toBe(false);
      expect(result.buckets).toHaveLength(9); // 3 sections x 3 difficulties
      expect(result.buckets.every((b) => !b.sufficient)).toBe(true);
    });

    it('reports ready:true only once every bucket meets its required count', async () => {
      const { service, groupBy } = buildHarness();
      const full = [
        { section: 'GRAMMAR', difficulty: 'EASY', _count: { _all: 2 } },
        { section: 'GRAMMAR', difficulty: 'MEDIUM', _count: { _all: 1 } },
        { section: 'GRAMMAR', difficulty: 'HARD', _count: { _all: 1 } },
        { section: 'VOCABULARY', difficulty: 'EASY', _count: { _all: 2 } },
        { section: 'VOCABULARY', difficulty: 'MEDIUM', _count: { _all: 1 } },
        { section: 'VOCABULARY', difficulty: 'HARD', _count: { _all: 1 } },
        { section: 'LISTENING', difficulty: 'EASY', _count: { _all: 2 } },
        { section: 'LISTENING', difficulty: 'MEDIUM', _count: { _all: 1 } },
        { section: 'LISTENING', difficulty: 'HARD', _count: { _all: 1 } },
      ];
      groupBy.mockResolvedValueOnce(full as never);
      const result = await service.getCoverage();
      expect(result.ready).toBe(true);
    });

    it('reports ready:false when exactly one bucket is one short', async () => {
      const { service, groupBy } = buildHarness();
      groupBy.mockResolvedValueOnce([
        { section: 'GRAMMAR', difficulty: 'EASY', _count: { _all: 1 } }, // needs 2
      ] as never);
      const result = await service.getCoverage();
      expect(result.ready).toBe(false);
      const grammarEasy = result.buckets.find(
        (b) => b.section === 'GRAMMAR' && b.difficulty === 'EASY',
      );
      expect(grammarEasy?.sufficient).toBe(false);
      expect(grammarEasy?.available).toBe(1);
      expect(grammarEasy?.required).toBe(2);
    });

    it('only counts PUBLISHED questions', async () => {
      const { service, groupBy } = buildHarness();
      await service.getCoverage();
      expect(groupBy).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isPublished: true } }),
      );
    });
  });

  describe('findAllManage', () => {
    it('filters by section and difficulty when provided', async () => {
      const { service, findMany } = buildHarness();
      await service.findAllManage({ section: 'LISTENING', difficulty: 'HARD' } as never);
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { section: 'LISTENING', difficulty: 'HARD' },
        }),
      );
    });

    it('caps the page size at MAX_LIMIT (100) even if a larger limit is requested', async () => {
      const { service, findMany } = buildHarness();
      await service.findAllManage({ limit: 500 } as never);
      expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));
    });
  });
});
