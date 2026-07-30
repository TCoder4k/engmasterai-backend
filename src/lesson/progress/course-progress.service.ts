import { Injectable } from '@nestjs/common';
import { LessonTaskType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { filterAccessibleCourses } from '../quiz/lesson-visibility';
import { ProgressScope, scopeToLessonWhere } from '../quiz/progress-scope';
import { QuizService } from '../quiz/quiz.service';
import { TrapHunterService } from '../quiz/trap-hunter.service';
import { EMPTY_STEPS, LessonStepService } from '../steps/lesson-step.service';
import {
  deriveCourseSummary,
  deriveLessonStatus,
  LessonStatusRow,
} from './lesson-status';
import { CourseProgressSummaryDto } from './lesson-progress.types';

// Sprint 08 — GET /progress/courses.
//
// STRUCTURE: a READ-ONLY aggregate, on the same terms as
// LessonProgressService. It composes the batch collectors the stage services
// already expose and never calls a mutation, so it cannot become the place
// where writes get orchestrated behind an owning service's back. It holds no
// completion rules of its own either — those live in the pure lesson-status.ts
// and are shared, not reimplemented.
//
// QUERY COST: ten queries, and — the property that actually matters — that
// number is CONSTANT. It does not grow with the number of courses requested or
// the number of lessons they contain, because every query takes an `IN` list
// built once:
//
//   1     filterAccessibleCourses  (visibility)
//   2     lesson.findMany          (id, courseId, orderIndex, videoUrl, notes)
//   3-4   collectTaskProgress(QUIZ)
//   5-7   collectTrapProgress
//   8-9   collectTaskProgress(PRACTICE)
//   10    collectSteps
//
// This replaces a CLIENT-side N+1: GrammarRoadmapPage issued two requests per
// course (progress + lessons), so a twelve-course roadmap cost 24 round trips
// and roughly 9 queries each. It now costs one round trip and ten queries.
//
// THE ONE COST THAT IS NOT CONSTANT is `notes`, loaded for every lesson so
// theory availability can be evaluated. It cannot be avoided: hasTheory is an
// input to every count, not just to the per-lesson array, so it is needed even
// when `include=lessons` is absent. The control is the DTO's ArrayMaxSize(20).
// If a batch ever needs more than ~500 lessons, denormalise hasTheory onto
// Lesson — but not before, because a persisted derived field drifts.
@Injectable()
export class CourseProgressService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quiz: QuizService,
    private readonly trapHunter: TrapHunterService,
    private readonly steps: LessonStepService,
  ) {}

  async getCourseProgress(
    courseIds: string[],
    userId: string,
    options: { includeLessons: boolean },
  ): Promise<CourseProgressSummaryDto[]> {
    // Filters rather than throwing: one stale id on a catalog page must not
    // fail the request for every other course beside it. See the note on
    // filterAccessibleCourses.
    const visibleIds = await filterAccessibleCourses(this.prisma, courseIds);
    if (visibleIds.length === 0) return [];

    const scope: ProgressScope = { kind: 'courses', courseIds: visibleIds };

    const [lessons, quizRows, trapRows, practiceRows, stepsByLesson] =
      await Promise.all([
        this.prisma.lesson.findMany({
          where: scopeToLessonWhere(scope),
          orderBy: { orderIndex: 'asc' },
          select: {
            id: true,
            courseId: true,
            orderIndex: true,
            videoUrl: true,
            notes: true,
          },
        }),
        this.quiz.collectTaskProgress(scope, userId, LessonTaskType.QUIZ),
        this.trapHunter.collectTrapProgress(scope, userId),
        this.quiz.collectTaskProgress(scope, userId, LessonTaskType.PRACTICE),
        this.steps.collectSteps(scope, userId),
      ]);

    const quizByLesson = new Map(quizRows.map((row) => [row.lessonId, row]));
    const trapByLesson = new Map(trapRows.map((row) => [row.lessonId, row]));
    const practiceByLesson = new Map(
      practiceRows.map((row) => [row.lessonId, row]),
    );

    // A missing collector row means the lesson has no such PUBLISHED task —
    // not that the student has not started it. lesson-status.ts reads null as
    // "this stage does not exist here", which is what keeps a lesson without a
    // quiz able to reach 100%.
    const rowsByCourse = new Map<string, LessonStatusRow[]>();
    for (const lesson of lessons) {
      const quiz = quizByLesson.get(lesson.id) ?? null;
      const trap = trapByLesson.get(lesson.id) ?? null;
      const practice = practiceByLesson.get(lesson.id) ?? null;

      const status = deriveLessonStatus({
        videoUrl: lesson.videoUrl,
        notes: lesson.notes,
        steps: stepsByLesson.get(lesson.id) ?? EMPTY_STEPS,
        quiz: quiz
          ? { passed: quiz.passed, attemptsCount: quiz.attemptsCount }
          : null,
        trapHunter: trap
          ? {
              hasSource: trap.hasSource,
              total: trap.total,
              cleared: trap.cleared,
            }
          : null,
        practice: practice
          ? { passed: practice.passed, attemptsCount: practice.attemptsCount }
          : null,
      });

      const list = rowsByCourse.get(lesson.courseId) ?? [];
      list.push({ lessonId: lesson.id, orderIndex: lesson.orderIndex, status });
      rowsByCourse.set(lesson.courseId, list);
    }

    // Every VISIBLE course gets a row, including one with no published lessons
    // at all — that is a real state (0/0, 0%, NOT_STARTED) and the client must
    // be able to tell it apart from "this course was not in the response".
    return visibleIds.map((courseId) => {
      const rows = rowsByCourse.get(courseId) ?? [];
      const summary = deriveCourseSummary(rows);
      return {
        courseId,
        ...summary,
        lessons: options.includeLessons
          ? rows.map((row) => ({
              lessonId: row.lessonId,
              orderIndex: row.orderIndex,
              status: row.status,
            }))
          : null,
      };
    });
  }
}
