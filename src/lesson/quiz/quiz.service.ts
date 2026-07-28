import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { Prisma, QuizFeedbackMode, TaskProgressStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UpsertQuizDto, SubmitQuizDto, AnswerQuestionDto } from './dto';
import {
  gradeQuestion,
  QuestionOption,
  validateQuestionContent,
} from './grade-question';
import {
  InvalidQuestionContentException,
  QuizAttemptIncompleteException,
  QuizHasAttemptsException,
  QuizIdempotencyConflictException,
  QuizNotImmediateFeedbackException,
  QuizNotPublishedException,
} from './quiz.exceptions';
import {
  AnswerQuestionResponseDto,
  CourseQuizProgressRowDto,
  GetQuizResponseDto,
  ManageQuizDto,
  QuestionResultDto,
  SubmitQuizResponseDto,
} from './quiz.types';

// A student's attempt clock is discarded past this gap (a tab left open
// overnight) — the summary omits the number rather than showing a
// fabricated one. Two hours comfortably covers a real, uninterrupted quiz
// session without accepting an obviously-stale timestamp.
const MAX_ATTEMPT_DURATION_SECONDS = 2 * 60 * 60;

const STUDENT_QUESTION_SELECT = {
  id: true,
  type: true,
  difficulty: true,
  content: true,
  options: true,
  audioUrl: true,
  imageUrl: true,
  orderIndex: true,
};

// Invariant 9: this select is the ONLY place a question's `correctAnswer`
// or `explanation` may be read for a response that reaches a student.
// STUDENT_QUESTION_SELECT above deliberately omits both.
const MANAGE_QUESTION_SELECT = {
  ...STUDENT_QUESTION_SELECT,
  correctAnswer: true,
  explanation: true,
};

// Deterministic key ordering so two answer sets with the same content but
// differently-ordered object keys still compare equal for idempotency.
const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([a], [b]) => a.localeCompare(b),
    );
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

// Fisher-Yates over a seeded PRNG. Used only to shuffle ORDERING option
// DISPLAY order — the correct order lives in Question.correctAnswer, which
// this function never touches and which the student response never carries.
//
// Seeded (Sprint 06B.5) rather than random-per-call so the order stays
// stable for the life of one attempt: an unseeded shuffle would visibly
// re-order the options under an already-graded question on every refresh.
const seededShuffle = <T>(items: T[], seed: string): T[] => {
  // xmur3 string hash → mulberry32 PRNG. Small, dependency-free, and more
  // than good enough for display ordering (no security property rests on it).
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let state = (h ^= h >>> 16) >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};

// Sprint 06B.5 — the shape stored in LessonTaskProgress.currentAttemptAnswers.
// One record per question the student has answered in the CURRENT attempt.
interface RecordedAnswer {
  submitted: unknown;
  isCorrect: boolean;
  answeredAt: string;
}

// The column holds the whole in-flight attempt, not just its answers, so a
// retake is recognised by the attempt id changing rather than needing a
// separate reset call or another column.
interface CurrentAttempt {
  clientAttemptId: string;
  answers: Record<string, RecordedAnswer>;
}

const readCurrentAttempt = (value: unknown): CurrentAttempt | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<CurrentAttempt>;
  if (typeof candidate.clientAttemptId !== 'string') return null;
  if (!candidate.answers || typeof candidate.answers !== 'object') return null;
  return {
    clientAttemptId: candidate.clientAttemptId,
    answers: candidate.answers,
  };
};

// Consecutive correct answers ending at the most recently answered question.
// Ordered by answeredAt (not question order) so the number means what a
// student would call "in a row" even if they navigated back and forth.
const trailingCorrectStreak = (
  answers: Record<string, RecordedAnswer>,
): number => {
  const ordered = Object.values(answers).sort((a, b) =>
    a.answeredAt.localeCompare(b.answeredAt),
  );
  let streak = 0;
  for (let i = ordered.length - 1; i >= 0; i--) {
    if (!ordered[i].isCorrect) break;
    streak++;
  }
  return streak;
};

@Injectable()
export class QuizService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private get defaultPassingScorePercent(): number {
    return this.config.get<number>('QUIZ_DEFAULT_PASSING_SCORE_PERCENT', 70);
  }

  // Same anti-probing shape as LessonService.findOnePublished: a 404 here
  // never distinguishes "lesson doesn't exist" from "lesson/course is a
  // draft", so an authenticated caller can't use this endpoint to enumerate
  // unpublished content.
  private async assertLessonVisible(lessonId: string): Promise<void> {
    const lesson = await this.prisma.lesson.findUnique({
      where: { id: lessonId },
      select: { isPublished: true, course: { select: { isPublished: true } } },
    });
    if (!lesson || !lesson.isPublished || !lesson.course.isPublished) {
      throw new NotFoundException(`Quiz for lesson ${lessonId} not found`);
    }
  }

  private async assertLessonExists(lessonId: string): Promise<void> {
    const lesson = await this.prisma.lesson.findUnique({
      where: { id: lessonId },
      select: { id: true },
    });
    if (!lesson)
      throw new NotFoundException(`Lesson with ID ${lessonId} not found`);
  }

  private async assertCourseAccessible(courseId: string): Promise<void> {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: { isPublished: true },
    });
    if (!course || !course.isPublished) {
      throw new NotFoundException(`Course with ID ${courseId} not found`);
    }
  }

  // GET /lessons/:lessonId/quiz (student). Same 404 whether the lesson,
  // course, or quiz itself is missing/unpublished.
  async getStudentQuiz(
    lessonId: string,
    userId: string,
  ): Promise<GetQuizResponseDto> {
    await this.assertLessonVisible(lessonId);

    const task = await this.prisma.lessonTask.findFirst({
      where: { lessonId, type: 'QUIZ', isPublished: true },
      select: {
        id: true,
        passingScorePercent: true,
        feedbackMode: true,
        questions: {
          orderBy: { orderIndex: 'asc' },
          select: STUDENT_QUESTION_SELECT,
        },
      },
    });
    if (!task)
      throw new NotFoundException(`Quiz for lesson ${lessonId} not found`);

    const now = new Date();
    const progress = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.lessonTaskProgress.findUnique({
        where: { userId_taskId: { userId, taskId: task.id } },
      });
      if (!existing) {
        return tx.lessonTaskProgress.create({
          data: {
            userId,
            taskId: task.id,
            maxScore: task.questions.length,
            attemptStartedAt: now,
            currentAttemptSeed: randomUUID(),
          },
        });
      }
      // Only stamp a fresh clock when no attempt is currently in flight —
      // a mid-quiz refresh must not reset the timer.
      if (!existing.attemptStartedAt) {
        return tx.lessonTaskProgress.update({
          where: { id: existing.id },
          data: { attemptStartedAt: now, currentAttemptSeed: randomUUID() },
        });
      }
      return existing;
    });

    const recorded =
      readCurrentAttempt(progress.currentAttemptAnswers)?.answers ?? {};
    const answeredIds = Object.keys(recorded);

    // Invariant 9 (Sprint 06B.5): correct answers are fetched in a SECOND,
    // narrowly-scoped query covering only the ids the student has already
    // answered — so a correct answer for an unanswered question is never
    // even loaded into memory here, let alone serialised. Skipped entirely
    // when nothing has been answered yet.
    const answeredContent =
      answeredIds.length > 0
        ? await this.prisma.question.findMany({
            where: { id: { in: answeredIds }, taskId: task.id },
            select: { id: true, correctAnswer: true, explanation: true },
          })
        : [];
    const answeredContentById = new Map(answeredContent.map((q) => [q.id, q]));

    const seed = progress.currentAttemptSeed ?? progress.id;
    const questions = task.questions.map((q) => {
      const record = recorded[q.id];
      const content = answeredContentById.get(q.id);
      return {
        ...q,
        options:
          q.type === 'ORDERING' && Array.isArray(q.options)
            ? seededShuffle(
                q.options as unknown as QuestionOption[],
                `${seed}:${q.id}`,
              )
            : (q.options as unknown as QuestionOption[] | null),
        answered:
          record && content
            ? {
                submitted: record.submitted,
                isCorrect: record.isCorrect,
                correctAnswer: content.correctAnswer,
                explanation: content.explanation,
              }
            : null,
      };
    });

    return {
      quiz: {
        taskId: task.id,
        passingScorePercent:
          task.passingScorePercent ?? this.defaultPassingScorePercent,
        feedbackMode: task.feedbackMode,
        questions,
      },
      progress: {
        attemptsCount: progress.attemptsCount,
        bestScorePercent:
          progress.attemptsCount > 0 && progress.maxScore > 0
            ? Math.floor((progress.score / progress.maxScore) * 100)
            : null,
        passed: progress.completedAt !== null,
        lastDurationSeconds: progress.lastDurationSeconds,
      },
    };
  }

  // POST /lessons/:lessonId/quiz/answer (student, IMMEDIATE mode only).
  //
  // Grades ONE question, records the result server-side, and returns the
  // correct answer + authored explanation so the student learns at the
  // moment of being wrong. The recorded result — never anything the client
  // later reports — is what POST .../submit scores the attempt from.
  async answerQuestion(
    lessonId: string,
    userId: string,
    dto: AnswerQuestionDto,
  ): Promise<AnswerQuestionResponseDto> {
    await this.assertLessonVisible(lessonId);

    const task = await this.prisma.lessonTask.findFirst({
      where: { lessonId, type: 'QUIZ', isPublished: true },
      select: {
        id: true,
        feedbackMode: true,
        questions: {
          orderBy: { orderIndex: 'asc' },
          select: MANAGE_QUESTION_SELECT,
        },
      },
    });
    if (!task)
      throw new NotFoundException(`Quiz for lesson ${lessonId} not found`);
    if (task.feedbackMode !== QuizFeedbackMode.IMMEDIATE) {
      throw new QuizNotImmediateFeedbackException();
    }

    const question = task.questions.find((q) => q.id === dto.questionId);
    if (!question)
      throw new NotFoundException(
        `Question ${dto.questionId} does not belong to this quiz`,
      );

    const totalCount = task.questions.length;

    return this.prisma.$transaction(async (tx) => {
      let progress = await tx.lessonTaskProgress.findUnique({
        where: { userId_taskId: { userId, taskId: task.id } },
      });
      if (!progress) {
        progress = await tx.lessonTaskProgress.create({
          data: {
            userId,
            taskId: task.id,
            maxScore: totalCount,
            attemptStartedAt: new Date(),
            currentAttemptSeed: randomUUID(),
          },
        });
      }

      const stored = readCurrentAttempt(progress.currentAttemptAnswers);
      // A different attempt id means the student retook the quiz — start
      // the record over rather than mixing two attempts' answers.
      const attempt: CurrentAttempt =
        stored && stored.clientAttemptId === dto.clientAttemptId
          ? stored
          : { clientAttemptId: dto.clientAttemptId, answers: {} };

      const existingRecord = attempt.answers[question.id];
      if (existingRecord) {
        // Already answered in this attempt — replay verbatim. This is the
        // server half of "lock the question after grading": no re-grade, no
        // write, so a double-click or a retried request cannot change a
        // score even though the client now knows the correct answer.
        return {
          questionId: question.id,
          isCorrect: existingRecord.isCorrect,
          correctAnswer: question.correctAnswer,
          explanation: question.explanation,
          answeredCount: Object.keys(attempt.answers).length,
          totalCount,
          currentStreak: trailingCorrectStreak(attempt.answers),
          allAnswered: Object.keys(attempt.answers).length >= totalCount,
        };
      }

      const isCorrect = gradeQuestion(question, dto.submitted);
      attempt.answers[question.id] = {
        submitted: dto.submitted ?? null,
        isCorrect,
        answeredAt: new Date().toISOString(),
      };

      await tx.lessonTaskProgress.update({
        where: { id: progress.id },
        data: {
          status: TaskProgressStatus.IN_PROGRESS,
          currentAttemptAnswers: attempt as unknown as Prisma.InputJsonValue,
        },
      });

      const answeredCount = Object.keys(attempt.answers).length;
      return {
        questionId: question.id,
        isCorrect,
        correctAnswer: question.correctAnswer,
        explanation: question.explanation,
        answeredCount,
        totalCount,
        currentStreak: trailingCorrectStreak(attempt.answers),
        allAnswered: answeredCount >= totalCount,
      };
    });
  }

  // POST /lessons/:lessonId/quiz/submit (student). The ONLY endpoint in the
  // whole quiz surface whose response ever carries a correctAnswer.
  async submitQuiz(
    lessonId: string,
    userId: string,
    dto: SubmitQuizDto,
  ): Promise<SubmitQuizResponseDto> {
    await this.assertLessonVisible(lessonId);

    const task = await this.prisma.lessonTask.findFirst({
      where: { lessonId, type: 'QUIZ', isPublished: true },
      select: {
        id: true,
        passingScorePercent: true,
        feedbackMode: true,
        questions: {
          orderBy: { orderIndex: 'asc' },
          select: MANAGE_QUESTION_SELECT,
        },
      },
    });
    if (!task)
      throw new NotFoundException(`Quiz for lesson ${lessonId} not found`);

    const isImmediate = task.feedbackMode === QuizFeedbackMode.IMMEDIATE;

    if (!isImmediate && (!dto.answers || dto.answers.length === 0)) {
      throw new BadRequestException(
        'answers must contain at least 1 element for a quiz that grades on submit.',
      );
    }

    // Duplicate questionIds in the submission collapse to the last value —
    // never an error, since a stale client retry could plausibly send one.
    // Under IMMEDIATE feedback this map is built from the SERVER's recorded
    // answers instead (below) and anything the client sent is discarded.
    const answersByQuestionId = new Map<string, unknown>();
    for (const answer of dto.answers ?? [])
      answersByQuestionId.set(answer.questionId, answer.submitted);

    return this.prisma.$transaction(async (tx) => {
      let progress = await tx.lessonTaskProgress.findUnique({
        where: { userId_taskId: { userId, taskId: task.id } },
      });
      if (!progress) {
        progress = await tx.lessonTaskProgress.create({
          data: { userId, taskId: task.id, maxScore: task.questions.length },
        });
      }

      // The scoring source. Under IMMEDIATE feedback every question was
      // already graded by answerQuestion() and the verdict stored; the
      // client has since been told every correct answer, so its own report
      // is worthless as evidence and is ignored outright.
      const recorded = isImmediate
        ? (readCurrentAttempt(progress.currentAttemptAnswers)?.answers ?? {})
        : null;

      if (recorded) {
        const remaining = task.questions.filter((q) => !recorded[q.id]).length;
        if (remaining > 0) throw new QuizAttemptIncompleteException(remaining);
      }

      const answersRecord: Record<string, unknown> = recorded
        ? Object.fromEntries(
            Object.entries(recorded).map(([id, r]) => [id, r.submitted]),
          )
        : Object.fromEntries(answersByQuestionId);

      if (progress.lastClientAttemptId === dto.clientAttemptId) {
        const previousAnswers = (progress.lastAnswers ?? {}) as Record<
          string,
          unknown
        >;
        if (
          stableStringify(previousAnswers) !== stableStringify(answersRecord)
        ) {
          throw new QuizIdempotencyConflictException();
        }
        return progress.lastSubmitResult as unknown as SubmitQuizResponseDto;
      }

      const results: QuestionResultDto[] = task.questions.map((question) => {
        if (recorded) {
          const record = recorded[question.id];
          return {
            questionId: question.id,
            isCorrect: record.isCorrect,
            submitted: record.submitted,
            correctAnswer: question.correctAnswer,
            explanation: question.explanation,
          };
        }
        const submitted = answersByQuestionId.get(question.id) ?? null;
        const isCorrect =
          submitted !== null && gradeQuestion(question, submitted);
        return {
          questionId: question.id,
          isCorrect,
          submitted,
          correctAnswer: question.correctAnswer,
          explanation: question.explanation,
        };
      });

      const totalCount = task.questions.length;
      const correctCount = results.filter((r) => r.isCorrect).length;
      const accuracyPercent =
        totalCount > 0 ? Math.floor((correctCount / totalCount) * 100) : 0;
      const passingScorePercent =
        task.passingScorePercent ?? this.defaultPassingScorePercent;
      const passed = accuracyPercent >= passingScorePercent;

      let durationSeconds: number | null = null;
      if (progress.attemptStartedAt) {
        const elapsed = Math.round(
          (Date.now() - progress.attemptStartedAt.getTime()) / 1000,
        );
        durationSeconds =
          elapsed >= 0 && elapsed <= MAX_ATTEMPT_DURATION_SECONDS
            ? elapsed
            : null;
      }

      const priorBestPercent =
        progress.attemptsCount > 0 && progress.maxScore > 0
          ? Math.floor((progress.score / progress.maxScore) * 100)
          : -1;
      const isNewBest = accuracyPercent > priorBestPercent;

      const attemptsCount = progress.attemptsCount + 1;
      const bestScorePercent = isNewBest ? accuracyPercent : priorBestPercent;

      const responseBody: SubmitQuizResponseDto = {
        correctCount,
        totalCount,
        accuracyPercent,
        passed,
        passingScorePercent,
        attemptsCount,
        bestScorePercent,
        durationSeconds,
        results,
      };

      await tx.lessonTaskProgress.update({
        where: { id: progress.id },
        data: {
          attemptsCount,
          score: isNewBest ? correctCount : progress.score,
          maxScore: isNewBest ? totalCount : progress.maxScore,
          // Set on first pass, never cleared on a later failed retry.
          completedAt: progress.completedAt ?? (passed ? new Date() : null),
          // Attempt consumed — the next GET stamps a fresh clock and a
          // fresh ORDERING shuffle seed.
          attemptStartedAt: null,
          currentAttemptAnswers: Prisma.JsonNull,
          currentAttemptSeed: null,
          lastDurationSeconds: durationSeconds,
          lastClientAttemptId: dto.clientAttemptId,
          lastAnswers: answersRecord as unknown as Prisma.InputJsonValue,
          lastSubmitResult: responseBody as unknown as Prisma.InputJsonValue,
        },
      });

      return responseBody;
    });
  }

  // GET /courses/:courseId/quiz-progress (student) — one row per
  // quiz-bearing published lesson in the course, one request instead of N.
  async getCourseQuizProgress(
    courseId: string,
    userId: string,
  ): Promise<CourseQuizProgressRowDto[]> {
    await this.assertCourseAccessible(courseId);

    const tasks = await this.prisma.lessonTask.findMany({
      where: {
        type: 'QUIZ',
        isPublished: true,
        lesson: { courseId, isPublished: true },
      },
      select: { id: true, lessonId: true },
    });
    if (tasks.length === 0) return [];

    const progressRows = await this.prisma.lessonTaskProgress.findMany({
      where: { userId, taskId: { in: tasks.map((t) => t.id) } },
    });
    const progressByTaskId = new Map(progressRows.map((p) => [p.taskId, p]));

    return tasks.map((task) => {
      const progress = progressByTaskId.get(task.id);
      return {
        lessonId: task.lessonId,
        passed: Boolean(progress?.completedAt),
        bestScorePercent:
          progress && progress.attemptsCount > 0 && progress.maxScore > 0
            ? Math.floor((progress.score / progress.maxScore) * 100)
            : null,
        attemptsCount: progress?.attemptsCount ?? 0,
      };
    });
  }

  // --- Admin -----------------------------------------------------------------

  // GET /lessons/:lessonId/quiz/manage
  async getManageQuiz(lessonId: string): Promise<ManageQuizDto> {
    await this.assertLessonExists(lessonId);

    const task = await this.prisma.lessonTask.findFirst({
      where: { lessonId, type: 'QUIZ' },
      select: {
        id: true,
        isPublished: true,
        passingScorePercent: true,
        feedbackMode: true,
        questions: {
          orderBy: { orderIndex: 'asc' },
          select: MANAGE_QUESTION_SELECT,
        },
      },
    });

    if (!task) {
      return {
        taskId: null,
        isPublished: false,
        passingScorePercent: null,
        // Matches the schema default, so the editor's control shows the
        // mode a not-yet-created quiz would actually get.
        feedbackMode: QuizFeedbackMode.IMMEDIATE,
        questionCount: 0,
        questions: [],
      };
    }

    return {
      taskId: task.id,
      isPublished: task.isPublished,
      passingScorePercent: task.passingScorePercent,
      feedbackMode: task.feedbackMode,
      questionCount: task.questions.length,
      questions: task.questions as unknown as ManageQuizDto['questions'],
    };
  }

  // PUT /lessons/:lessonId/quiz — whole-document upsert. Question ids
  // present in the current set but absent from `dto.questions` are deleted;
  // ids present are updated; questions with no id are created. orderIndex
  // is the array's own position, so there is no separate reorder endpoint.
  async upsertQuiz(
    lessonId: string,
    dto: UpsertQuizDto,
  ): Promise<ManageQuizDto> {
    await this.assertLessonExists(lessonId);

    dto.questions.forEach((question, index) => {
      const optionIds = (question.options ?? []).map((o) => o.id);
      if (new Set(optionIds).size !== optionIds.length) {
        throw new InvalidQuestionContentException(
          index,
          'option ids must be unique.',
        );
      }
      const reason = validateQuestionContent({
        type: question.type,
        options: question.options ?? null,
        correctAnswer: question.correctAnswer,
      });
      if (reason) throw new InvalidQuestionContentException(index, reason);
    });

    await this.prisma.$transaction(async (tx) => {
      let task = await tx.lessonTask.findFirst({
        where: { lessonId, type: 'QUIZ' },
      });

      if (!task) {
        const maxOrderIndex = await tx.lessonTask.aggregate({
          where: { lessonId },
          _max: { orderIndex: true },
        });
        task = await tx.lessonTask.create({
          data: {
            lessonId,
            type: 'QUIZ',
            title: 'Quiz',
            content: {},
            points: dto.questions.length,
            orderIndex: (maxOrderIndex._max.orderIndex ?? -1) + 1,
            passingScorePercent: dto.passingScorePercent ?? null,
            // Absent leaves the schema default (IMMEDIATE) in place.
            ...(dto.feedbackMode ? { feedbackMode: dto.feedbackMode } : {}),
          },
        });
      } else {
        task = await tx.lessonTask.update({
          where: { id: task.id },
          data: {
            points: dto.questions.length,
            passingScorePercent: dto.passingScorePercent ?? null,
            // Absent leaves an existing quiz's mode untouched rather than
            // silently resetting it — unlike passingScorePercent, whose
            // whole-document-replace semantics an author expects.
            ...(dto.feedbackMode ? { feedbackMode: dto.feedbackMode } : {}),
          },
        });
      }

      const existingQuestions = await tx.question.findMany({
        where: { taskId: task.id },
        select: { id: true },
      });
      const existingIds = new Set(existingQuestions.map((q) => q.id));
      const incomingIds = new Set(
        dto.questions.filter((q) => q.id).map((q) => q.id as string),
      );

      const idsToDelete = [...existingIds].filter((id) => !incomingIds.has(id));
      if (idsToDelete.length > 0) {
        await tx.question.deleteMany({ where: { id: { in: idsToDelete } } });
      }

      for (const [index, question] of dto.questions.entries()) {
        const data = {
          taskId: task.id,
          type: question.type,
          content: question.content,
          difficulty: question.difficulty ?? null,
          // Prisma requires the explicit JsonNull sentinel (not bare `null`)
          // to set a nullable Json column to SQL NULL — plain `null` there
          // means "don't touch this field" in an update.
          options: question.options
            ? (question.options as unknown as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          // Already `unknown` on the DTO, so a single cast is enough here
          // (unlike `options` above, which is a typed array).
          correctAnswer: question.correctAnswer as Prisma.InputJsonValue,
          explanation: question.explanation ?? null,
          audioUrl: question.audioUrl ?? null,
          imageUrl: question.imageUrl ?? null,
          orderIndex: index,
        };

        if (question.id && existingIds.has(question.id)) {
          await tx.question.update({ where: { id: question.id }, data });
        } else {
          await tx.question.create({ data });
        }
      }
    });

    return this.getManageQuiz(lessonId);
  }

  // PATCH /lessons/:lessonId/quiz/publish
  async publishQuiz(lessonId: string): Promise<ManageQuizDto> {
    await this.assertLessonExists(lessonId);

    const task = await this.prisma.lessonTask.findFirst({
      where: { lessonId, type: 'QUIZ' },
      include: { _count: { select: { questions: true } } },
    });
    if (!task)
      throw new NotFoundException(
        `No quiz has been created for lesson ${lessonId} yet.`,
      );
    if (task._count.questions === 0) throw new QuizNotPublishedException();

    await this.prisma.lessonTask.update({
      where: { id: task.id },
      data: { isPublished: true },
    });
    return this.getManageQuiz(lessonId);
  }

  // PATCH /lessons/:lessonId/quiz/unpublish
  async unpublishQuiz(lessonId: string): Promise<ManageQuizDto> {
    await this.assertLessonExists(lessonId);

    const task = await this.prisma.lessonTask.findFirst({
      where: { lessonId, type: 'QUIZ' },
    });
    if (!task)
      throw new NotFoundException(
        `No quiz has been created for lesson ${lessonId} yet.`,
      );

    await this.prisma.lessonTask.update({
      where: { id: task.id },
      data: { isPublished: false },
    });
    return this.getManageQuiz(lessonId);
  }

  // DELETE /lessons/:lessonId/quiz — refuses (409) once any student has a
  // real attempt (attemptsCount > 0). View-only progress rows (a student
  // opened the quiz but never submitted) do not block deletion.
  async deleteQuiz(lessonId: string): Promise<void> {
    await this.assertLessonExists(lessonId);

    const task = await this.prisma.lessonTask.findFirst({
      where: { lessonId, type: 'QUIZ' },
    });
    if (!task)
      throw new NotFoundException(
        `No quiz has been created for lesson ${lessonId} yet.`,
      );

    const attemptedCount = await this.prisma.lessonTaskProgress.count({
      where: { taskId: task.id, attemptsCount: { gt: 0 } },
    });
    if (attemptedCount > 0) throw new QuizHasAttemptsException();

    await this.prisma.$transaction([
      // View-only progress rows (attemptsCount 0) are not real attempts and
      // do not block deletion, but LessonTaskProgress.task is Restrict, so
      // they still need clearing before the task itself can go.
      this.prisma.lessonTaskProgress.deleteMany({ where: { taskId: task.id } }),
      this.prisma.question.deleteMany({ where: { taskId: task.id } }),
      this.prisma.lessonTask.delete({ where: { id: task.id } }),
    ]);
  }
}
