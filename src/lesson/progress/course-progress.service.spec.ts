import { LessonTaskType } from '@prisma/client';
import { CourseProgressService } from './course-progress.service';
import { EMPTY_STEPS } from '../steps/lesson-step.service';

// Sprint 08 — the course aggregate, against a mocked Prisma.
//
// THE NO-N+1 PROOF LIVES HERE, not in an e2e test. The obvious way to assert
// query count end-to-end is a Prisma `$on('query')` counter, but PrismaService
// constructs the client with a bare `super()` and no
// `log: [{ emit: 'event', level: 'query' }]`, so query events are never
// emitted and the handler would never fire — a test that passes by observing
// nothing. Enabling the event globally would change every module's runtime
// behaviour to serve one assertion.
//
// Counting calls on a mock measures the property directly: the aggregate must
// issue the same number of database round trips for ten courses as for one.

interface Lesson {
  id: string;
  courseId: string;
  orderIndex: number;
  videoUrl: string | null;
  notes: string | null;
}

const buildHarness = (options: {
  courseIds: string[];
  lessons: Lesson[];
  quizRows?: { lessonId: string; passed: boolean; attemptsCount: number }[];
  trapRows?: {
    lessonId: string;
    hasSource: boolean;
    total: number;
    cleared: number;
  }[];
  practiceRows?: { lessonId: string; passed: boolean; attemptsCount: number }[];
  steps?: Map<string, typeof EMPTY_STEPS>;
}) => {
  // One counter per database round trip, whoever makes it.
  const calls = { total: 0 };
  const count = <T>(value: T): Promise<T> => {
    calls.total += 1;
    return Promise.resolve(value);
  };

  const prisma = {
    course: {
      findMany: jest.fn(() => count(options.courseIds.map((id) => ({ id })))),
    },
    lesson: {
      findMany: jest.fn(() => count(options.lessons)),
    },
  };

  const quiz = {
    // Two queries inside: tasks, then progress rows.
    collectTaskProgress: jest.fn(
      (_scope, _userId, taskType: LessonTaskType) => {
        calls.total += 2;
        return Promise.resolve(
          taskType === LessonTaskType.QUIZ
            ? (options.quizRows ?? [])
            : (options.practiceRows ?? []),
        );
      },
    ),
  };

  const trapHunter = {
    // Three queries inside: tasks, progress rows, live questions.
    collectTrapProgress: jest.fn(() => {
      calls.total += 3;
      return Promise.resolve(options.trapRows ?? []);
    }),
  };

  const steps = {
    collectSteps: jest.fn(() => count(options.steps ?? new Map())),
  };

  const service = new CourseProgressService(
    prisma as never,
    quiz as never,
    trapHunter as never,
    steps as never,
  );

  return { service, calls, prisma, quiz, trapHunter, steps };
};

const makeLessons = (courseIds: string[], perCourse: number): Lesson[] =>
  courseIds.flatMap((courseId, courseIndex) =>
    Array.from({ length: perCourse }, (_, i) => ({
      id: `${courseIndex}-${i}`,
      courseId,
      orderIndex: i,
      videoUrl: 'https://youtu.be/abc',
      notes: null,
    })),
  );

describe('CourseProgressService', () => {
  describe('query cost', () => {
    // The property that matters is not "ten" — it is that the number does not
    // move. If someone later reads a course inside the lesson loop, this fails
    // regardless of what the constant happens to be that week.
    it('issues the same number of queries for 1, 3 and 10 courses', async () => {
      const counts: number[] = [];

      for (const courseCount of [1, 3, 10]) {
        const courseIds = Array.from(
          { length: courseCount },
          (_, i) => `course-${i}`,
        );
        const { service, calls } = buildHarness({
          courseIds,
          lessons: makeLessons(courseIds, 5),
        });
        await service.getCourseProgress(courseIds, 'user-1', {
          includeLessons: true,
        });
        counts.push(calls.total);
      }

      expect(counts).toEqual([10, 10, 10]);
    });

    it('issues the same number of queries for 5 lessons as for 200', async () => {
      const courseIds = ['course-0'];
      const results: number[] = [];

      for (const perCourse of [5, 200]) {
        const { service, calls } = buildHarness({
          courseIds,
          lessons: makeLessons(courseIds, perCourse),
        });
        await service.getCourseProgress(courseIds, 'user-1', {
          includeLessons: true,
        });
        results.push(calls.total);
      }

      expect(results[0]).toBe(results[1]);
    });

    it('makes no query at all when every requested course is invisible', async () => {
      const { service, calls, quiz } = buildHarness({
        courseIds: [], // filterAccessibleCourses finds nothing published
        lessons: [],
      });
      const result = await service.getCourseProgress(['gone'], 'user-1', {
        includeLessons: false,
      });

      expect(result).toEqual([]);
      // Only the visibility check ran; no collector was reached.
      expect(calls.total).toBe(1);
      expect(quiz.collectTaskProgress).not.toHaveBeenCalled();
    });
  });

  describe('response shape', () => {
    it('returns a row for every visible course, including one with no lessons', async () => {
      const { service } = buildHarness({
        courseIds: ['empty-course'],
        lessons: [],
      });

      const [summary] = await service.getCourseProgress(
        ['empty-course'],
        'user-1',
        { includeLessons: true },
      );

      // A real state, distinguishable from "this course was not in the
      // response" — the client renders 0/0 rather than an error.
      expect(summary).toMatchObject({
        courseId: 'empty-course',
        totalLessons: 0,
        progressPercent: 0,
        status: 'NOT_STARTED',
        continueLessonId: null,
      });
      expect(summary.lessons).toEqual([]);
    });

    it('omits the lessons array unless include=lessons is asked for', async () => {
      const courseIds = ['c1'];
      const { service } = buildHarness({
        courseIds,
        lessons: makeLessons(courseIds, 3),
      });

      const [withLessons] = await service.getCourseProgress(courseIds, 'u', {
        includeLessons: true,
      });
      const [without] = await service.getCourseProgress(courseIds, 'u', {
        includeLessons: false,
      });

      expect(withLessons.lessons).toHaveLength(3);
      expect(without.lessons).toBeNull();
      // The counts are identical either way — the flag controls payload only.
      expect(without.totalLessons).toBe(withLessons.totalLessons);
    });

    it('groups lessons by course and never mixes them', async () => {
      const courseIds = ['a', 'b'];
      const { service } = buildHarness({
        courseIds,
        lessons: [
          {
            id: 'a1',
            courseId: 'a',
            orderIndex: 0,
            videoUrl: 'v',
            notes: null,
          },
          {
            id: 'b1',
            courseId: 'b',
            orderIndex: 0,
            videoUrl: 'v',
            notes: null,
          },
          {
            id: 'b2',
            courseId: 'b',
            orderIndex: 1,
            videoUrl: 'v',
            notes: null,
          },
        ],
      });

      const result = await service.getCourseProgress(courseIds, 'u', {
        includeLessons: true,
      });

      expect(result.find((row) => row.courseId === 'a')?.totalLessons).toBe(1);
      expect(result.find((row) => row.courseId === 'b')?.totalLessons).toBe(2);
    });

    it('excludes a lesson with no completable stage from the totals', async () => {
      // The audio-only lesson: published, but no video, no notes, no tasks.
      const courseIds = ['c1'];
      const { service } = buildHarness({
        courseIds,
        lessons: [
          {
            id: 'video',
            courseId: 'c1',
            orderIndex: 0,
            videoUrl: 'v',
            notes: null,
          },
          {
            id: 'audio',
            courseId: 'c1',
            orderIndex: 1,
            videoUrl: null,
            notes: null,
          },
        ],
        steps: new Map([
          [
            'video',
            {
              video: {
                step: 'VIDEO' as never,
                startedAt: '2026-07-30T00:00:00.000Z',
                completedAt: '2026-07-30T00:10:00.000Z',
                lastActivityAt: '2026-07-30T00:10:00.000Z',
                highestPositionSeconds: 100,
                videoDurationSeconds: 100,
              },
              theory: null,
            },
          ],
        ]),
      });

      const [summary] = await service.getCourseProgress(courseIds, 'u', {
        includeLessons: true,
      });

      // One countable lesson, finished — so the course IS complete, rather
      // than stuck at 50% forever because of a lesson nothing can complete.
      expect(summary.totalLessons).toBe(1);
      expect(summary.progressPercent).toBe(100);
      expect(summary.status).toBe('COMPLETED');
      // The excluded lesson is still reported, so the row can render honestly.
      expect(summary.lessons).toEqual([
        { lessonId: 'video', orderIndex: 0, status: 'COMPLETED' },
        { lessonId: 'audio', orderIndex: 1, status: 'NO_CONTENT' },
      ]);
    });

    it('treats a lesson with no published quiz as having no quiz stage', async () => {
      const courseIds = ['c1'];
      const { service } = buildHarness({
        courseIds,
        lessons: [
          {
            id: 'l1',
            courseId: 'c1',
            orderIndex: 0,
            videoUrl: 'v',
            notes: null,
          },
        ],
        quizRows: [], // no row => no published QUIZ task on this lesson
        steps: new Map([
          [
            'l1',
            {
              video: {
                step: 'VIDEO' as never,
                startedAt: '2026-07-30T00:00:00.000Z',
                completedAt: '2026-07-30T00:10:00.000Z',
                lastActivityAt: '2026-07-30T00:10:00.000Z',
                highestPositionSeconds: 100,
                videoDurationSeconds: 100,
              },
              theory: null,
            },
          ],
        ]),
      });

      const [summary] = await service.getCourseProgress(courseIds, 'u', {
        includeLessons: false,
      });

      // A missing task must never create a requirement that cannot be met.
      expect(summary.status).toBe('COMPLETED');
    });
  });

  describe('scope', () => {
    it('passes the batch scope to every collector, never one course at a time', async () => {
      const courseIds = ['a', 'b', 'c'];
      const { service, quiz, trapHunter, steps } = buildHarness({
        courseIds,
        lessons: makeLessons(courseIds, 2),
      });

      await service.getCourseProgress(courseIds, 'u', {
        includeLessons: false,
      });

      const expected = { kind: 'courses', courseIds };
      expect(quiz.collectTaskProgress).toHaveBeenCalledTimes(2); // QUIZ + PRACTICE
      expect(quiz.collectTaskProgress).toHaveBeenCalledWith(
        expected,
        'u',
        LessonTaskType.QUIZ,
      );
      expect(trapHunter.collectTrapProgress).toHaveBeenCalledWith(
        expected,
        'u',
      );
      expect(steps.collectSteps).toHaveBeenCalledWith(expected, 'u');
    });

    it('scopes collectors to the VISIBLE ids, not the requested ones', async () => {
      // 'hidden' is unpublished, so filterAccessibleCourses drops it and the
      // collectors must never see it.
      const { service, quiz } = buildHarness({
        courseIds: ['visible'],
        lessons: [],
      });

      await service.getCourseProgress(['visible', 'hidden'], 'u', {
        includeLessons: false,
      });

      expect(quiz.collectTaskProgress).toHaveBeenCalledWith(
        { kind: 'courses', courseIds: ['visible'] },
        'u',
        LessonTaskType.QUIZ,
      );
    });
  });
});
