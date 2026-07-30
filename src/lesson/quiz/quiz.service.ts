import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import {
  LessonTaskProgress,
  LessonTaskType,
  Prisma,
  QuizFeedbackMode,
  TaskProgressStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UpsertQuizDto, SubmitQuizDto, AnswerQuestionDto } from './dto';
import {
  gradeQuestion,
  QuestionOption,
  validateQuestionContent,
} from './grade-question';
// Sprint 06C — both extracted so TrapHunterService shares them rather than
// growing its own near-copy of a 404 policy and a seeded shuffle.
import { seededShuffle } from './seeded-shuffle';
import { ProgressScope, scopeToTaskWhere } from './progress-scope';
import {
  assertCourseAccessible,
  assertLessonVisible,
} from './lesson-visibility';
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

// Sprint 07 — rebuild the { questionId: submitted } map from a stored
// LessonTaskAttempt.result, so the P2002 backstop can compare an old attempt's
// answers against a resubmission the same way the fast path compares
// progress.lastAnswers.
//
// Reads from the frozen response body rather than a separate answers column
// precisely so there is ONE stored representation of an attempt — a second
// column holding the same answers in a different shape is how the two drift.
const extractSubmittedAnswers = (result: unknown): Record<string, unknown> => {
  const results = (result as { results?: QuestionResultDto[] } | null)?.results;
  if (!Array.isArray(results)) return {};
  return Object.fromEntries(results.map((r) => [r.questionId, r.submitted]));
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

// Sprint 06D — task types are a parameter now, so a 404 must not say "Quiz"
// for a Practice task. Only the two question-bearing types are nameable here;
// nothing else reaches this engine.
const TASK_LABEL: Partial<Record<LessonTaskType, string>> = {
  QUIZ: 'Quiz',
  PRACTICE: 'Practice',
};
const taskLabel = (taskType: LessonTaskType): string =>
  TASK_LABEL[taskType] ?? 'Task';

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

  // Delegates to the shared helper (Sprint 06C) — kept as a method so every
  // call site below reads unchanged.
  private assertLessonVisible(lessonId: string): Promise<void> {
    return assertLessonVisible(this.prisma, lessonId);
  }

  private async assertLessonExists(lessonId: string): Promise<void> {
    const lesson = await this.prisma.lesson.findUnique({
      where: { id: lessonId },
      select: { id: true },
    });
    if (!lesson)
      throw new NotFoundException(`Lesson with ID ${lessonId} not found`);
  }

  private assertCourseAccessible(courseId: string): Promise<void> {
    return assertCourseAccessible(this.prisma, courseId);
  }

  // Sprint 06D — the student read path, split in two.
  //
  // readStudentTask() NEVER WRITES. startStudentAttempt() is the only thing
  // that stamps an attempt clock or mints a shuffle seed.
  //
  // The quiz composes both, because its GET has always started an attempt and
  // that behaviour is deliberately unchanged. Advanced Practice calls them
  // separately, so rendering its intro screen cannot record an attempt the
  // student never began — which is the whole reason for the split, since
  // reusing the composed version would have started a clock on a screen whose
  // only button is "Start Practice".
  //
  // It is also why neither method needs to know which task type it serves:
  // the difference between the quiz and practice is which of the two a caller
  // composes, not a branch inside either.
  private async resolveStudentTask(lessonId: string, taskType: LessonTaskType) {
    const task = await this.prisma.lessonTask.findFirst({
      where: { lessonId, type: taskType, isPublished: true },
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
      throw new NotFoundException(
        `${taskLabel(taskType)} for lesson ${lessonId} not found`,
      );
    return task;
  }

  // GET /lessons/:lessonId/quiz (student). Same 404 whether the lesson,
  // course, or quiz itself is missing/unpublished.
  //
  // Sprint 07 — READ-ONLY. This used to delegate to startStudentAttempt, so
  // the GET wrote. See QuizStudentController.getQuiz for why that had to stop.
  async readStudentQuiz(
    lessonId: string,
    userId: string,
  ): Promise<GetQuizResponseDto> {
    return this.readStudentTask(lessonId, userId, LessonTaskType.QUIZ);
  }

  // POST /lessons/:lessonId/quiz/start (student) — the write half, now
  // explicit. Idempotent; see startStudentAttempt.
  async startQuizAttempt(
    lessonId: string,
    userId: string,
  ): Promise<GetQuizResponseDto> {
    return this.startStudentAttempt(lessonId, userId, LessonTaskType.QUIZ);
  }

  // Read-only. Returns exactly what the student is entitled to see given the
  // state already stored — and stores nothing itself. Safe to call from an
  // intro screen, a stage tile, or any surface that must not have side
  // effects.
  async readStudentTask(
    lessonId: string,
    userId: string,
    taskType: LessonTaskType,
  ): Promise<GetQuizResponseDto> {
    await this.assertLessonVisible(lessonId);
    const task = await this.resolveStudentTask(lessonId, taskType);
    const progress = await this.prisma.lessonTaskProgress.findUnique({
      where: { userId_taskId: { userId, taskId: task.id } },
    });
    return this.buildStudentTaskView(task, progress);
  }

  // The write half. Idempotent by design: an attempt already in flight is
  // returned untouched, so a refresh, a double-click or a retried request
  // never restarts the clock or reshuffles a question the student is already
  // looking at.
  async startStudentAttempt(
    lessonId: string,
    userId: string,
    taskType: LessonTaskType,
  ): Promise<GetQuizResponseDto> {
    await this.assertLessonVisible(lessonId);
    const task = await this.resolveStudentTask(lessonId, taskType);

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

    return this.buildStudentTaskView(task, progress);
  }

  // Shared by both paths above. `progress` is nullable because the read path
  // must describe a task the student has never opened WITHOUT creating a row
  // for it.
  private async buildStudentTaskView(
    task: Awaited<ReturnType<QuizService['resolveStudentTask']>>,
    progress: LessonTaskProgress | null,
  ): Promise<GetQuizResponseDto> {
    const currentAttempt = readCurrentAttempt(
      progress?.currentAttemptAnswers ?? null,
    );
    const recorded = currentAttempt?.answers ?? {};
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

    // With no progress row yet (read path, never opened) the task id is a
    // stable stand-in: the shuffle has to be deterministic per request, and
    // startStudentAttempt mints the real per-attempt seed the moment the
    // student actually begins.
    const seed = progress?.currentAttemptSeed ?? progress?.id ?? task.id;
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
        // Handed back so a client that lost its draft resumes the SAME
        // attempt instead of minting an id the answer endpoint would treat
        // as a retake — see StudentQuizDto.
        currentAttemptId: currentAttempt?.clientAttemptId ?? null,
        questions,
      },
      // A missing row is a real zero-state, not a gap to guess at: never
      // opened means no attempts, no best score and not passed. Derived, not
      // persisted — the read path must not create a row just to describe one.
      progress: {
        attemptsCount: progress?.attemptsCount ?? 0,
        bestScorePercent:
          progress && progress.attemptsCount > 0 && progress.maxScore > 0
            ? Math.floor((progress.score / progress.maxScore) * 100)
            : null,
        passed: progress?.completedAt != null,
        lastDurationSeconds: progress?.lastDurationSeconds ?? null,
      },
      // Sprint 07 — the stored summary of the most recently FINISHED attempt,
      // so revisiting a completed quiz shows what the student scored instead
      // of dropping them into a blank attempt. The client fetched `progress`
      // already and simply had nothing to render from it.
      //
      // Returned ONLY when no attempt is in flight. That is the whole
      // security argument: this body carries correctAnswer for every question
      // (it is the same SubmitQuizResponseDto the summary screen was already
      // shown), so releasing it mid-attempt would hand a student the answers
      // to questions they have not yet answered. With no attempt in flight
      // there is nothing to cheat at, and they have already seen all of it.
      lastResult:
        progress && !progress.attemptStartedAt
          ? ((progress.lastSubmitResult as unknown as SubmitQuizResponseDto) ??
            null)
          : null,
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
    return this.answerTaskQuestion(lessonId, userId, LessonTaskType.QUIZ, dto);
  }

  async answerTaskQuestion(
    lessonId: string,
    userId: string,
    taskType: LessonTaskType,
    dto: AnswerQuestionDto,
  ): Promise<AnswerQuestionResponseDto> {
    await this.assertLessonVisible(lessonId);

    const task = await this.prisma.lessonTask.findFirst({
      where: { lessonId, type: taskType, isPublished: true },
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
      throw new NotFoundException(
        `${taskLabel(taskType)} for lesson ${lessonId} not found`,
      );
    if (task.feedbackMode !== QuizFeedbackMode.IMMEDIATE) {
      throw new QuizNotImmediateFeedbackException();
    }

    const question = task.questions.find((q) => q.id === dto.questionId);
    if (!question)
      throw new NotFoundException(
        `Question ${dto.questionId} does not belong to this ${taskLabel(taskType).toLowerCase()}`,
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
    return this.submitTask(lessonId, userId, LessonTaskType.QUIZ, dto);
  }

  async submitTask(
    lessonId: string,
    userId: string,
    taskType: LessonTaskType,
    dto: SubmitQuizDto,
  ): Promise<SubmitQuizResponseDto> {
    await this.assertLessonVisible(lessonId);

    const task = await this.prisma.lessonTask.findFirst({
      where: { lessonId, type: taskType, isPublished: true },
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
      throw new NotFoundException(
        `${taskLabel(taskType)} for lesson ${lessonId} not found`,
      );

    const isImmediate = task.feedbackMode === QuizFeedbackMode.IMMEDIATE;

    if (!isImmediate && (!dto.answers || dto.answers.length === 0)) {
      throw new BadRequestException(
        `answers must contain at least 1 element for a ${taskLabel(taskType).toLowerCase()} that grades on submit.`,
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

      // ---- IDEMPOTENCY FAST PATH ------------------------------------------
      //
      // Sprint 07 moved this ABOVE the completeness check below, and split it
      // by feedback mode. Both halves of that change are required; the reorder
      // alone was not enough.
      //
      // The bug it fixes: a successful submit sets currentAttemptAnswers to
      // JsonNull. Replaying that submit therefore rebuilt `recorded` as {} and
      // the completeness check fired first — "N questions still need an
      // answer" — for a quiz the student had just completed. IMMEDIATE is the
      // schema default, so this was the common path, and the only replay test
      // in the suite lived in the ON_SUBMIT block where it could not catch it.
      //
      // Why the mode split: under IMMEDIATE the client sends NO answers at all
      // (grading already happened per question), so there is nothing to
      // compare and comparing is itself the bug — {} would never equal the
      // stored answers and every replay would 409. Under ON_SUBMIT the client
      // does send answers, so the comparison is meaningful and stays: same id
      // with DIFFERENT answers is a genuine conflict and must never be
      // silently re-graded.
      if (progress.lastClientAttemptId === dto.clientAttemptId) {
        if (!isImmediate) {
          const previousAnswers = (progress.lastAnswers ?? {}) as Record<
            string,
            unknown
          >;
          const submitted = Object.fromEntries(answersByQuestionId);
          if (stableStringify(previousAnswers) !== stableStringify(submitted)) {
            throw new QuizIdempotencyConflictException();
          }
        }
        return progress.lastSubmitResult as unknown as SubmitQuizResponseDto;
      }

      // ---- IDEMPOTENCY DEEP PATH ------------------------------------------
      //
      // The fast path above remembers exactly ONE attempt back, so a client
      // replaying an id from two attempts ago slips past it. The append-only
      // history remembers all of them.
      //
      // This is a PRE-CHECK, not a catch around the insert below, and that is
      // load-bearing: a unique violation aborts the surrounding Postgres
      // transaction, so a P2002 handler cannot query for the row it needs to
      // replay — it can only produce the 500 this exists to prevent. The
      // constraint stays as a true integrity backstop; correctness is enforced
      // here, before anything is written.
      //
      // It also sits ABOVE the completeness check for the same reason the fast
      // path does: a finished attempt has no in-flight answers left, so under
      // IMMEDIATE feedback a replay would otherwise be rejected as incomplete.
      const priorAttempt = await tx.lessonTaskAttempt.findUnique({
        where: {
          userId_clientAttemptId: {
            userId,
            clientAttemptId: dto.clientAttemptId,
          },
        },
      });
      if (priorAttempt) {
        // The same two observable outcomes as the fast path, so the contract
        // does not depend on which layer recognised the replay.
        if (!isImmediate) {
          const previousAnswers = extractSubmittedAnswers(priorAttempt.result);
          const submitted = Object.fromEntries(answersByQuestionId);
          if (stableStringify(previousAnswers) !== stableStringify(submitted)) {
            throw new QuizIdempotencyConflictException();
          }
        }
        return priorAttempt.result as unknown as SubmitQuizResponseDto;
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

      // ---- APPEND-ONLY HISTORY (Sprint 07) --------------------------------
      //
      // Written BEFORE the progress update and inside the same transaction, so
      // the cache below can never describe an attempt this table does not
      // contain. Before this row existed, a retake overwrote lastAnswers and
      // lastSubmitResult, destroying the record of the attempt it replaced —
      // including the student's BEST one, whose score survived as a scalar
      // while the answers that earned it did not.
      //
      // The unique (userId, clientAttemptId) is an integrity backstop only —
      // replays are recognised by the deep pre-check above, before anything is
      // written. If this insert ever DOES violate the constraint it means two
      // concurrent submits raced past that check, and failing the transaction
      // is the correct outcome: one attempt is recorded, not two.
      await tx.lessonTaskAttempt.create({
        data: {
          userId,
          taskId: task.id,
          correctCount,
          totalCount,
          accuracyPercent,
          passed,
          durationSeconds,
          result: responseBody as unknown as Prisma.InputJsonValue,
          clientAttemptId: dto.clientAttemptId,
        },
      });

      await tx.lessonTaskProgress.update({
        where: { id: progress.id },
        data: {
          attemptsCount,
          score: isNewBest ? correctCount : progress.score,
          maxScore: isNewBest ? totalCount : progress.maxScore,
          // Set on first pass, never cleared on a later failed retry.
          completedAt: progress.completedAt ?? (passed ? new Date() : null),
          // Attempt consumed — the next start stamps a fresh clock and a
          // fresh ORDERING shuffle seed.
          attemptStartedAt: null,
          currentAttemptAnswers: Prisma.JsonNull,
          currentAttemptSeed: null,
          // Sprint 07 — only overwrite when this attempt actually produced a
          // duration. It used to write unconditionally, so an attempt with no
          // attemptStartedAt (a submit that never went through start, or a
          // second submit after the field was nulled just above) replaced a
          // perfectly good stored duration with null.
          ...(durationSeconds !== null
            ? { lastDurationSeconds: durationSeconds }
            : {}),
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
    return this.collectCourseTaskProgress(
      courseId,
      userId,
      LessonTaskType.QUIZ,
    );
  }

  // Sprint 06D — the visibility check is the CALLER's responsibility here, so
  // the aggregated stage-progress endpoint can check the course once and then
  // roll up several task types without repeating it per type.
  //
  // Sprint 07 — kept as a one-line delegation so every existing caller and
  // test is untouched, while the real implementation below is scope-agnostic.
  async collectCourseTaskProgress(
    courseId: string,
    userId: string,
    taskType: LessonTaskType,
  ): Promise<CourseQuizProgressRowDto[]> {
    return this.collectTaskProgress(
      { kind: 'course', courseId },
      userId,
      taskType,
    );
  }

  // Sprint 07 — the same roll-up over either a whole course or one lesson.
  // The lesson aggregate (GET /lessons/:lessonId/progress) needs exactly this
  // view for a single lesson; without the scope parameter it would either read
  // the entire course to answer a one-lesson question, or grow a second
  // implementation of "what does stage progress mean" that can drift from this
  // one.
  async collectTaskProgress(
    scope: ProgressScope,
    userId: string,
    taskType: LessonTaskType,
  ): Promise<CourseQuizProgressRowDto[]> {
    const tasks = await this.prisma.lessonTask.findMany({
      where: {
        type: taskType,
        isPublished: true,
        ...scopeToTaskWhere(scope),
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
    return this.getManageTask(lessonId, LessonTaskType.QUIZ);
  }

  async getManageTask(
    lessonId: string,
    taskType: LessonTaskType,
  ): Promise<ManageQuizDto> {
    await this.assertLessonExists(lessonId);

    const task = await this.prisma.lessonTask.findFirst({
      where: { lessonId, type: taskType },
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
    return this.upsertTask(lessonId, LessonTaskType.QUIZ, dto);
  }

  async upsertTask(
    lessonId: string,
    taskType: LessonTaskType,
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
        where: { lessonId, type: taskType },
      });

      if (!task) {
        const maxOrderIndex = await tx.lessonTask.aggregate({
          where: { lessonId },
          _max: { orderIndex: true },
        });
        task = await tx.lessonTask.create({
          data: {
            lessonId,
            type: taskType,
            title: taskLabel(taskType),
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

    return this.getManageTask(lessonId, taskType);
  }

  // PATCH /lessons/:lessonId/quiz/publish
  async publishQuiz(lessonId: string): Promise<ManageQuizDto> {
    return this.publishTask(lessonId, LessonTaskType.QUIZ);
  }

  async publishTask(
    lessonId: string,
    taskType: LessonTaskType,
  ): Promise<ManageQuizDto> {
    await this.assertLessonExists(lessonId);

    const task = await this.prisma.lessonTask.findFirst({
      where: { lessonId, type: taskType },
      include: { _count: { select: { questions: true } } },
    });
    if (!task)
      throw new NotFoundException(
        `No ${taskLabel(taskType).toLowerCase()} has been created for lesson ${lessonId} yet.`,
      );
    if (task._count.questions === 0) throw new QuizNotPublishedException();

    await this.prisma.lessonTask.update({
      where: { id: task.id },
      data: { isPublished: true },
    });
    return this.getManageTask(lessonId, taskType);
  }

  // PATCH /lessons/:lessonId/quiz/unpublish
  async unpublishQuiz(lessonId: string): Promise<ManageQuizDto> {
    return this.unpublishTask(lessonId, LessonTaskType.QUIZ);
  }

  async unpublishTask(
    lessonId: string,
    taskType: LessonTaskType,
  ): Promise<ManageQuizDto> {
    await this.assertLessonExists(lessonId);

    const task = await this.prisma.lessonTask.findFirst({
      where: { lessonId, type: taskType },
    });
    if (!task)
      throw new NotFoundException(
        `No ${taskLabel(taskType).toLowerCase()} has been created for lesson ${lessonId} yet.`,
      );

    await this.prisma.lessonTask.update({
      where: { id: task.id },
      data: { isPublished: false },
    });
    return this.getManageTask(lessonId, taskType);
  }

  // DELETE /lessons/:lessonId/quiz — refuses (409) once any student has a
  // real attempt (attemptsCount > 0). View-only progress rows (a student
  // opened the quiz but never submitted) do not block deletion.
  async deleteQuiz(lessonId: string): Promise<void> {
    return this.deleteTask(lessonId, LessonTaskType.QUIZ);
  }

  async deleteTask(lessonId: string, taskType: LessonTaskType): Promise<void> {
    await this.assertLessonExists(lessonId);

    const task = await this.prisma.lessonTask.findFirst({
      where: { lessonId, type: taskType },
    });
    if (!task)
      throw new NotFoundException(
        `No ${taskLabel(taskType).toLowerCase()} has been created for lesson ${lessonId} yet.`,
      );

    // Sprint 07 — both are checked, and deliberately so. The progress row's
    // attemptsCount is a CACHE; LessonTaskAttempt is the authoritative history
    // and is Restrict on `task`, so if the two ever disagreed the delete would
    // fail with a raw P2003 in front of an admin instead of this 409. Counting
    // the authoritative table too makes the refusal correct by construction
    // rather than by the cache happening to be right.
    const [attemptedCount, historyCount] = await Promise.all([
      this.prisma.lessonTaskProgress.count({
        where: { taskId: task.id, attemptsCount: { gt: 0 } },
      }),
      this.prisma.lessonTaskAttempt.count({ where: { taskId: task.id } }),
    ]);
    if (attemptedCount > 0 || historyCount > 0)
      throw new QuizHasAttemptsException();

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
