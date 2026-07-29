import { Injectable } from '@nestjs/common';
import { LessonTaskType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { QuizService } from './quiz.service';
import { TrapHunterService } from './trap-hunter.service';
import { AnswerQuestionDto, SubmitQuizDto } from './dto';
import {
  assertLessonVisible,
  assertCourseAccessible,
} from './lesson-visibility';
import {
  PracticeAttemptNotStartedException,
  PracticePrerequisitesNotMetException,
} from './quiz.exceptions';
import { resolvePracticePrerequisites } from './practice-prerequisites';
import { AnswerQuestionResponseDto, SubmitQuizResponseDto } from './quiz.types';
import {
  CourseStageProgressRowDto,
  GetPracticeResponseDto,
  PracticeAvailabilityDto,
  PracticeTaskSummaryDto,
  StartPracticeResponseDto,
} from './practice.types';

// Sprint 06D — Advanced Practice.
//
// THIS SERVICE IS DELIBERATELY THIN. It owns exactly three things the quiz
// engine has no business knowing about: whether the stage is available, when
// its prerequisites are met, and the fact that an attempt must be started
// explicitly. Everything that involves a question, a grade, a score or a
// progress row is delegated to QuizService with `LessonTaskType.PRACTICE`.
//
// WHY NOT PUT THIS IN QuizService: because the whole justification for
// parameterising that service was that it is task-type-agnostic. Adding an
// `if (taskType === 'PRACTICE')` branch for prerequisites would have
// re-specialised the exact code whose value is being generic, and the next
// task type would have added a second branch beside it. The engine grades
// tasks; this service knows what Advanced Practice means.
//
// Grading is the unchanged pure gradeQuestion() reached through that engine.
// There is no second grader anywhere in this sprint.
@Injectable()
export class PracticeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quiz: QuizService,
    private readonly trapHunter: TrapHunterService,
  ) {}

  // Gathers the two server-verifiable prerequisites. Reads trap state through
  // TrapHunterService rather than re-deriving "did this attempt have
  // mistakes" from lastSubmitResult — one definition of a trap, not two that
  // can drift.
  private async resolvePrerequisites(lessonId: string, userId: string) {
    const quizTask = await this.prisma.lessonTask.findFirst({
      where: { lessonId, type: LessonTaskType.QUIZ, isPublished: true },
      select: { id: true },
    });

    if (!quizTask) {
      // No quiz on this lesson: nothing to pass and no mistakes to correct.
      return resolvePracticePrerequisites({
        hasPublishedQuiz: false,
        quizPassed: false,
        trapsTotal: 0,
        trapsCleared: 0,
      });
    }

    const quizProgress = await this.prisma.lessonTaskProgress.findUnique({
      where: { userId_taskId: { userId, taskId: quizTask.id } },
      select: { completedAt: true },
    });

    const traps = await this.trapHunter.getTrapHunter(lessonId, userId);

    return resolvePracticePrerequisites({
      hasPublishedQuiz: true,
      quizPassed: quizProgress?.completedAt != null,
      trapsTotal: traps.progress.total,
      trapsCleared: traps.progress.cleared,
    });
  }

  private async findPracticeTask(lessonId: string) {
    return this.prisma.lessonTask.findFirst({
      where: { lessonId, type: LessonTaskType.PRACTICE, isPublished: true },
      select: { id: true },
    });
  }

  private assertPrerequisitesMet(result: {
    met: boolean;
    reason?: 'quiz_not_passed' | 'traps_outstanding';
  }): void {
    if (!result.met && result.reason) {
      throw new PracticePrerequisitesNotMetException(result.reason);
    }
  }

  // GET /lessons/:lessonId/practice — READ-ONLY.
  //
  // Writes nothing: no progress row is created, no attempt clock is stamped
  // and no shuffle seed is minted. That is the point. Rendering the intro
  // screen must not record an attempt the student never began, and the only
  // way to guarantee it is for this path to have no write in it at all.
  async getPractice(
    lessonId: string,
    userId: string,
  ): Promise<GetPracticeResponseDto> {
    await assertLessonVisible(this.prisma, lessonId);

    const task = await this.findPracticeTask(lessonId);
    if (!task) {
      return {
        availability: { state: 'unavailable', reason: 'no_published_task' },
        task: null,
        progress: {
          attemptsCount: 0,
          bestScorePercent: null,
          passed: false,
          lastDurationSeconds: null,
        },
        attempt: null,
      };
    }

    // readStudentTask never writes — see QuizService's read/start split.
    const view = await this.quiz.readStudentTask(
      lessonId,
      userId,
      LessonTaskType.PRACTICE,
    );

    const prerequisites = await this.resolvePrerequisites(lessonId, userId);
    const availability: PracticeAvailabilityDto = prerequisites.met
      ? { state: 'available' }
      : { state: 'blocked', reason: prerequisites.reason };

    const summary: PracticeTaskSummaryDto = {
      taskId: view.quiz.taskId,
      questionCount: view.quiz.questions.length,
      passingScorePercent: view.quiz.passingScorePercent,
      feedbackMode: view.quiz.feedbackMode,
    };

    // An attempt is in flight only when the server is already recording
    // answers against one. Otherwise the questions are simply not sent: there
    // is nothing to resume, and withholding them keeps this response the same
    // whether or not the student is allowed in yet.
    const inFlight = view.quiz.currentAttemptId !== null;

    return {
      availability,
      task: summary,
      progress: view.progress,
      attempt: inFlight ? view.quiz : null,
    };
  }

  // POST /lessons/:lessonId/practice/start — the explicit start contract, and
  // the prerequisite enforcement point for BOTH feedback modes.
  //
  // Idempotent: QuizService.startStudentAttempt returns an in-flight attempt
  // untouched, so a double-click or a refresh-then-start never restarts the
  // clock, reshuffles a question or counts a second attempt.
  async startPractice(
    lessonId: string,
    userId: string,
  ): Promise<StartPracticeResponseDto> {
    await assertLessonVisible(this.prisma, lessonId);
    this.assertPrerequisitesMet(
      await this.resolvePrerequisites(lessonId, userId),
    );

    const view = await this.quiz.startStudentAttempt(
      lessonId,
      userId,
      LessonTaskType.PRACTICE,
    );

    return {
      task: {
        taskId: view.quiz.taskId,
        questionCount: view.quiz.questions.length,
        passingScorePercent: view.quiz.passingScorePercent,
        feedbackMode: view.quiz.feedbackMode,
      },
      progress: view.progress,
      attempt: view.quiz,
    };
  }

  // POST /lessons/:lessonId/practice/answer (IMMEDIATE only).
  async answerPractice(
    lessonId: string,
    userId: string,
    dto: AnswerQuestionDto,
  ): Promise<AnswerQuestionResponseDto> {
    await assertLessonVisible(this.prisma, lessonId);
    this.assertPrerequisitesMet(
      await this.resolvePrerequisites(lessonId, userId),
    );
    await this.assertAttemptStarted(lessonId, userId);

    return this.quiz.answerTaskQuestion(
      lessonId,
      userId,
      LessonTaskType.PRACTICE,
      dto,
    );
  }

  // POST /lessons/:lessonId/practice/submit — finalises the attempt. Scoring,
  // best-score and idempotent replay are all the engine's, unchanged.
  async submitPractice(
    lessonId: string,
    userId: string,
    dto: SubmitQuizDto,
  ): Promise<SubmitQuizResponseDto> {
    await assertLessonVisible(this.prisma, lessonId);
    this.assertPrerequisitesMet(
      await this.resolvePrerequisites(lessonId, userId),
    );
    await this.assertAttemptStarted(lessonId, userId);

    return this.quiz.submitTask(lessonId, userId, LessonTaskType.PRACTICE, dto);
  }

  // Advanced Practice starts explicitly, so a mutation arriving with no
  // attempt clock is a client out of sync — not a reason to quietly create the
  // attempt, which would reintroduce exactly the implicit start that the
  // read/start split exists to remove.
  private async assertAttemptStarted(
    lessonId: string,
    userId: string,
  ): Promise<void> {
    const task = await this.findPracticeTask(lessonId);
    if (!task) return; // the engine's own 404 is the right error here

    const progress = await this.prisma.lessonTaskProgress.findUnique({
      where: { userId_taskId: { userId, taskId: task.id } },
      select: { attemptStartedAt: true },
    });
    if (!progress?.attemptStartedAt) {
      throw new PracticeAttemptNotStartedException();
    }
  }

  // GET /courses/:courseId/stage-progress — every stage with a backend, one
  // row per published lesson, ONE request.
  //
  // Replaces three separate course-level calls (quiz, trap hunter, practice).
  // Without it, adding a stage meant adding a round trip to every surface that
  // shows a percentage, and by Sprint 06E that would have been four.
  async getCourseStageProgress(
    courseId: string,
    userId: string,
  ): Promise<CourseStageProgressRowDto[]> {
    await assertCourseAccessible(this.prisma, courseId);

    const [quizRows, trapRows, practiceRows] = await Promise.all([
      this.quiz.collectCourseTaskProgress(
        courseId,
        userId,
        LessonTaskType.QUIZ,
      ),
      this.trapHunter.collectCourseTrapProgress(courseId, userId),
      this.quiz.collectCourseTaskProgress(
        courseId,
        userId,
        LessonTaskType.PRACTICE,
      ),
    ]);

    const quizByLesson = new Map(quizRows.map((r) => [r.lessonId, r]));
    const trapByLesson = new Map(trapRows.map((r) => [r.lessonId, r]));
    const practiceByLesson = new Map(practiceRows.map((r) => [r.lessonId, r]));

    const lessonIds = [
      ...new Set([
        ...quizRows.map((r) => r.lessonId),
        ...trapRows.map((r) => r.lessonId),
        ...practiceRows.map((r) => r.lessonId),
      ]),
    ];

    return lessonIds.map((lessonId) => {
      const quiz = quizByLesson.get(lessonId);
      const trap = trapByLesson.get(lessonId);
      const practice = practiceByLesson.get(lessonId);
      return {
        lessonId,
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
            }
          : null,
      };
    });
  }
}
