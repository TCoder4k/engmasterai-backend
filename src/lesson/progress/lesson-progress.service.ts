import { Injectable } from '@nestjs/common';
import { LessonTaskType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { assertLessonVisible } from '../quiz/lesson-visibility';
import { resolvePracticePrerequisites } from '../quiz/practice-prerequisites';
import { ProgressScope } from '../quiz/progress-scope';
import { QuizService } from '../quiz/quiz.service';
import { TrapHunterService } from '../quiz/trap-hunter.service';
import { EMPTY_STEPS, LessonStepService } from '../steps/lesson-step.service';
import {
  LessonProgressDto,
  LessonPracticeProgressDto,
} from './lesson-progress.types';

// Sprint 07 — the canonical read for the lesson page.
//
// STRUCTURE: this is a READ-ONLY aggregate. It composes the batch collectors
// the stage services already expose and never calls a mutation, so it cannot
// become the place where writes get orchestrated behind the owning service's
// back. Mutations stay with QuizService / TrapHunterService / PracticeService /
// LessonStepService; reads for the stepper are assembled here.
//
// It deliberately does NOT depend on PracticeService. Practice availability is
// computed from resolvePracticePrerequisites() — the same pure function the
// practice mutations enforce with — so this file needs the rule, not the
// service that owns the rule's side effects.
//
// QUERY COST: the visibility check plus four batch collectors, run in
// parallel. That is ~9 indexed queries per lesson-page load rather than the
// ~5 a hand-rolled flat implementation would use. The extra four buy a single
// definition of what quiz, trap and practice progress MEAN — duplicating the
// trap derivation here to save four indexed lookups on a handful of rows would
// trade a real correctness hazard for an immeasurable latency win. The
// property that matters holds: the count is CONSTANT, with no N+1 in either
// scope.
@Injectable()
export class LessonProgressService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quiz: QuizService,
    private readonly trapHunter: TrapHunterService,
    private readonly steps: LessonStepService,
  ) {}

  async getLessonProgress(
    lessonId: string,
    userId: string,
  ): Promise<LessonProgressDto> {
    // Checked ONCE here; the collectors below deliberately do not repeat it.
    await assertLessonVisible(this.prisma, lessonId);

    const scope: ProgressScope = { kind: 'lesson', lessonId };
    const [quizRows, trapRows, practiceRows, stepsByLesson] = await Promise.all(
      [
        this.quiz.collectTaskProgress(scope, userId, LessonTaskType.QUIZ),
        this.trapHunter.collectTrapProgress(scope, userId),
        this.quiz.collectTaskProgress(scope, userId, LessonTaskType.PRACTICE),
        this.steps.collectSteps(scope, userId),
      ],
    );

    // A missing row means the lesson has no such published task — NOT that the
    // student has not started it. The client renders those two very
    // differently ("Bài này không có" vs "Chưa học").
    const quiz = quizRows[0] ?? null;
    const trap = trapRows[0] ?? null;
    const practice = practiceRows[0] ?? null;

    return {
      steps: stepsByLesson.get(lessonId) ?? EMPTY_STEPS,
      quiz: quiz
        ? {
            passed: quiz.passed,
            bestScorePercent: quiz.bestScorePercent,
            attemptsCount: quiz.attemptsCount,
          }
        : null,
      trapHunter: trap
        ? {
            hasSource: trap.hasSource,
            total: trap.total,
            cleared: trap.cleared,
          }
        : null,
      practice: practice
        ? {
            passed: practice.passed,
            bestScorePercent: practice.bestScorePercent,
            attemptsCount: practice.attemptsCount,
            availability: buildAvailability(quiz, trap),
          }
        : null,
    };
  }
}

// The server's answer to "may this student start Practice yet", so the client
// no longer keeps its own copy of the rule.
//
// Note this is only ever called when a published Practice task exists, so the
// 'unavailable' / no_published_task state never arises here — the caller
// returns `practice: null` in that case, which the client already reads as
// "this lesson has no Practice stage".
const buildAvailability = (
  quiz: { passed: boolean } | null,
  trap: { total: number; cleared: number } | null,
): LessonPracticeProgressDto['availability'] => {
  const result = resolvePracticePrerequisites({
    hasPublishedQuiz: quiz !== null,
    quizPassed: quiz?.passed ?? false,
    trapsTotal: trap?.total ?? 0,
    trapsCleared: trap?.cleared ?? 0,
  });
  return result.met
    ? { state: 'available' }
    : { state: 'blocked', reason: result.reason };
};
