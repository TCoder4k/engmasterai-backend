import { ConfigService } from '@nestjs/config';
import { QuizService } from './quiz.service';

// Sprint 10 — QuizService now hands each submit to GamificationService inside
// the same transaction. Stubbed here: what an award is worth and when it is
// idempotent belongs to gamification.service.spec.ts, and duplicating it would
// mean two places to update. This file still owns grading and idempotency.
const stubGamification = () =>
  ({
    recordProgress: jest.fn().mockResolvedValue({
      xpAwarded: 0,
      xp: { totalXp: 0, level: 1, intoLevel: 0, toNextLevel: 100, percent: 0 },
      leveledUp: false,
      unlockedAchievements: [],
    }),
  }) as any;

// Sprint 06B — unit coverage for the pieces the e2e suite (which exercises
// the service through a real Prisma/Postgres connection) can't isolate as
// cheaply: the passing-score fallback and the attempt-duration cap. Every
// other behaviour (grading itself, idempotent replay, publish/delete
// guards, the student payload's invariants) is proven end-to-end in
// test/lesson-quiz.e2e-spec.ts against real data — this file exists for the
// two things worth pinning without a database.
describe('QuizService', () => {
  const buildConfig = (defaultPercent: number): ConfigService =>
    ({
      get: jest.fn().mockReturnValue(defaultPercent),
    }) as unknown as ConfigService;

  const publishedLesson = { isPublished: true, course: { isPublished: true } };

  describe('passing score fallback', () => {
    it('uses the env default when the task has no passingScorePercent', async () => {
      const progressRow = {
        id: 'p1',
        attemptsCount: 0,
        score: 0,
        maxScore: 0,
        completedAt: null,
        attemptStartedAt: new Date(),
        lastDurationSeconds: null,
      };
      const prisma = {
        lesson: { findUnique: jest.fn().mockResolvedValue(publishedLesson) },
        lessonTask: {
          findFirst: jest.fn().mockResolvedValue({
            id: 't1',
            passingScorePercent: null,
            feedbackMode: 'IMMEDIATE',
            questions: [],
          }),
        },
        $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) =>
          fn({
            lessonTaskProgress: {
              findUnique: jest.fn().mockResolvedValue(null),
              create: jest.fn().mockResolvedValue(progressRow),
              update: jest.fn().mockResolvedValue(progressRow),
            },
          }),
        ),
      };
      const service = new QuizService(prisma as any, buildConfig(65), stubGamification());

      const res = await service.startQuizAttempt('lesson-1', 'user-1');
      expect(res.quiz.passingScorePercent).toBe(65);
    });

    it('lets a per-quiz passingScorePercent override the env default', async () => {
      const progressRow = {
        id: 'p1',
        attemptsCount: 0,
        score: 0,
        maxScore: 0,
        completedAt: null,
        attemptStartedAt: new Date(),
        lastDurationSeconds: null,
      };
      const prisma = {
        lesson: { findUnique: jest.fn().mockResolvedValue(publishedLesson) },
        lessonTask: {
          findFirst: jest.fn().mockResolvedValue({
            id: 't1',
            passingScorePercent: 90,
            feedbackMode: 'IMMEDIATE',
            questions: [],
          }),
        },
        $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) =>
          fn({
            lessonTaskProgress: {
              findUnique: jest.fn().mockResolvedValue(null),
              create: jest.fn().mockResolvedValue(progressRow),
              update: jest.fn().mockResolvedValue(progressRow),
            },
          }),
        ),
      };
      const service = new QuizService(prisma as any, buildConfig(65), stubGamification());

      const res = await service.startQuizAttempt('lesson-1', 'user-1');
      expect(res.quiz.passingScorePercent).toBe(90);
    });
  });

  describe('attempt duration cap', () => {
    const oneQuestion = [
      {
        id: 'q1',
        type: 'TRUE_FALSE',
        correctAnswer: { value: true },
        explanation: null,
      },
    ];

    const submitWithElapsedMs = async (elapsedMs: number) => {
      const attemptStartedAt = new Date(Date.now() - elapsedMs);
      const progressRow = {
        id: 'p1',
        attemptsCount: 0,
        score: 0,
        maxScore: 0,
        completedAt: null,
        attemptStartedAt,
        lastClientAttemptId: null,
        lastAnswers: null,
      };
      const update = jest.fn();
      const prisma = {
        lesson: { findUnique: jest.fn().mockResolvedValue(publishedLesson) },
        lessonTask: {
          findFirst: jest.fn().mockResolvedValue({
            id: 't1',
            passingScorePercent: 70,
            // ON_SUBMIT: this test drives submit() with client-supplied
            // answers, which is exactly the path that mode still uses.
            // (IMMEDIATE would score from currentAttemptAnswers instead.)
            feedbackMode: 'ON_SUBMIT',
            questions: oneQuestion,
          }),
        },
        $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) =>
          fn({
            lessonTaskProgress: {
              findUnique: jest.fn().mockResolvedValue(progressRow),
              update,
            },
            // Sprint 07 — submit now also appends to the immutable attempt
            // history inside the same transaction.
            lessonTaskAttempt: {
              create: jest.fn().mockResolvedValue({}),
              findUnique: jest.fn().mockResolvedValue(null),
            },
          }),
        ),
      };
      const service = new QuizService(
        prisma as any,
        buildConfig(70),
        stubGamification(),
      );
      // Sprint 10 — submitQuiz now returns { response, gamification }. The
      // duration lives on `response`, which is the body that gets persisted
      // and replayed; keeping XP out of it is the point of the split.
      const { response } = await service.submitQuiz('lesson-1', 'user-1', {
        clientAttemptId: 'a1',
        answers: [{ questionId: 'q1', submitted: { value: true } }],
      });
      return { result: response, update };
    };

    it('reports elapsed time for a plausible attempt duration', async () => {
      const { result } = await submitWithElapsedMs(90_000); // 90s
      expect(result.durationSeconds).toBeGreaterThanOrEqual(89);
      expect(result.durationSeconds).toBeLessThanOrEqual(91);
    });

    it('nulls the duration once the gap exceeds the sane cap (a tab left open overnight)', async () => {
      const { result } = await submitWithElapsedMs(3 * 60 * 60 * 1000); // 3h > 2h cap
      expect(result.durationSeconds).toBeNull();
    });
  });
});
