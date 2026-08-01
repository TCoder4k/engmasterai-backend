import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AnswerTrapDto, RequestTrapHintDto } from './dto';
import { gradeQuestion, QuestionOption } from './grade-question';
import { ProgressScope, scopeToTaskWhere } from './progress-scope';
import {
  assertCourseAccessible,
  assertLessonVisible,
} from './lesson-visibility';
import {
  TrapHintUnavailableException,
  TrapHunterNotAvailableException,
} from './quiz.exceptions';
import { GamificationService } from '../../gamification/gamification.service';
import { noAward } from '../../gamification/gamification.types';
import { trapClearedAward } from '../../gamification/xp-rules';
import { buildTrapHints, HintableQuestion } from './trap-hints';
import {
  AnswerTrapResponseDto,
  CourseTrapHunterProgressRowDto,
  GetTrapHunterResponseDto,
  TrapDto,
  TrapHintResponseDto,
  TrapHunterProgressDto,
  TrapHunterState,
  TrapRecord,
} from './trap-hunter.types';

// Sprint 06C — Trap Hunter.
//
// The correction round over the mistakes of a student's most recent
// COMPLETED quiz attempt. Not a second quiz: it contains nothing but
// questions this student got wrong, it invents no content, and it never
// touches their score.
//
// TWO THINGS THIS SERVICE MUST NEVER DO, both load-bearing:
//
// 1. It writes exactly ONE column — LessonTaskProgress.trapHunterState.
//    score, maxScore, attemptsCount, completedAt, lastAnswers,
//    lastSubmitResult and currentAttemptAnswers belong to the quiz's own
//    scoring. Writing to any of them here would be duplicated scoring, and
//    would let a student inflate a quiz result by grinding traps. An e2e
//    test asserts all seven are byte-identical across a full trap run.
//
// 2. It never branches on CourseType, and never on QuizFeedbackMode either.
//    Traps come from mistakes. Both IMMEDIATE and ON_SUBMIT quizzes write
//    lastSubmitResult identically, so this stage works under either without
//    knowing which it is looking at — and will work under a future
//    Vocabulary, Listening, Writing or Speaking lesson unchanged.
//
// Correctness is decided by the same unchanged pure gradeQuestion() the quiz
// uses. There is no second grader anywhere in this file.

// The subset of a completed attempt's recorded results this service reads.
// Deliberately structural rather than an import of SubmitQuizResponseDto:
// this is JSON that was written by a possibly-older version of the code, so
// it is validated on the way in, not trusted by type assertion.
const readWrongAnswers = (value: unknown): Map<string, unknown> | null => {
  if (!value || typeof value !== 'object') return null;
  const results = (value as { results?: unknown }).results;
  if (!Array.isArray(results)) return null;

  const wrong = new Map<string, unknown>();
  for (const row of results) {
    if (!row || typeof row !== 'object') continue;
    const { questionId, isCorrect, submitted } = row as {
      questionId?: unknown;
      isCorrect?: unknown;
      submitted?: unknown;
    };
    // `isCorrect !== false` rather than `!isCorrect`: a malformed row with
    // no verdict at all is not evidence of a mistake, and inventing a trap
    // from it would put a question the student may well have answered
    // correctly in front of them.
    if (typeof questionId !== 'string' || isCorrect !== false) continue;
    wrong.set(questionId, submitted ?? null);
  }
  return wrong;
};

// Returns the stored state, or a fresh empty one when it is absent OR
// belongs to a superseded attempt. The staleness check is the whole reason
// sourceAttemptId lives inside the JSON: a quiz retake overwrites
// lastSubmitResult with a new set of mistakes, and carrying the old cleared
// flags across would mark traps solved that the student has not seen.
const readTrapState = (
  value: unknown,
  sourceAttemptId: string,
): TrapHunterState => {
  const empty: TrapHunterState = { sourceAttemptId, traps: {} };
  if (!value || typeof value !== 'object') return empty;

  const candidate = value as Partial<TrapHunterState>;
  if (candidate.sourceAttemptId !== sourceAttemptId) return empty;
  if (!candidate.traps || typeof candidate.traps !== 'object') return empty;
  return { sourceAttemptId, traps: candidate.traps };
};

// Coerces rather than spreads. `state.traps` came out of a Json column, so
// its contents are whatever some past version of this code (or a hand-edited
// row) put there — a spread would happily hand back `attempts: "3"`, and
// `attempts + 1` on that produces "31".
const recordFor = (state: TrapHunterState, questionId: string): TrapRecord => {
  const stored = state.traps[questionId];
  if (!stored || typeof stored !== 'object')
    return { attempts: 0, hintLevel: 0, clearedAt: null };
  return {
    attempts: Number.isInteger(stored.attempts) ? stored.attempts : 0,
    hintLevel: Number.isInteger(stored.hintLevel) ? stored.hintLevel : 0,
    clearedAt: typeof stored.clearedAt === 'string' ? stored.clearedAt : null,
  };
};

// Consecutive traps cleared FIRST TRY, ending at the most recently cleared
// one. A trap that took more than one go breaks the run — which is what
// makes the number mean something a student would recognise as a streak,
// rather than just "how many I have finished".
//
// Counted server-side from the recorded run; the client never tallies its
// own, exactly as with the quiz's currentStreak.
const trailingCleanClearStreak = (state: TrapHunterState): number => {
  const cleared = Object.values(state.traps)
    .filter((record): record is TrapRecord & { clearedAt: string } =>
      Boolean(record.clearedAt),
    )
    .sort((a, b) => a.clearedAt.localeCompare(b.clearedAt));

  let streak = 0;
  for (let i = cleared.length - 1; i >= 0; i--) {
    if (cleared[i].attempts > 0) break;
    streak++;
  }
  return streak;
};

// Everything needed to render and grade a trap. `correctAnswer` and
// `explanation` are loaded because hintsAvailable cannot be computed without
// them (see trap-hints.ts) — but they are serialised only for a trap the
// student has already cleared, or for a hint level they have deliberately
// unlocked.
//
// To be precise about what that sealing is and is not: it is hygiene, not a
// security boundary. POST /quiz/submit already returns correctAnswer and
// explanation for EVERY question (SubmitQuizResponseDto.results), so this
// client was handed all of it the moment the attempt was finished — that is
// what QuizReviewList renders. Keeping the trap payload sealed stops the UI
// from accidentally showing an unearned answer; it is not pretending to
// withhold a secret the student was never given.
const TRAP_QUESTION_SELECT = {
  id: true,
  type: true,
  difficulty: true,
  content: true,
  options: true,
  audioUrl: true,
  imageUrl: true,
  orderIndex: true,
  correctAnswer: true,
  explanation: true,
};

type TrapQuestion = {
  id: string;
  type: HintableQuestion['type'];
  difficulty: TrapDto['difficulty'];
  content: string;
  options: Prisma.JsonValue;
  audioUrl: string | null;
  imageUrl: string | null;
  orderIndex: number;
  correctAnswer: Prisma.JsonValue;
  explanation: string | null;
};

const asHintable = (question: TrapQuestion): HintableQuestion => ({
  id: question.id,
  type: question.type,
  options: question.options as unknown as QuestionOption[] | null,
  correctAnswer: question.correctAnswer,
  explanation: question.explanation,
});

@Injectable()
export class TrapHunterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gamification: GamificationService,
  ) {}

  // Resolves the published quiz task for a lesson. Same 404 as the quiz
  // endpoints, via the shared helper, so Trap Hunter cannot be used to probe
  // for unpublished content the quiz surface already hides.
  private async findQuizTask(lessonId: string): Promise<{ id: string }> {
    await assertLessonVisible(this.prisma, lessonId);
    const task = await this.prisma.lessonTask.findFirst({
      where: { lessonId, type: 'QUIZ', isPublished: true },
      select: { id: true },
    });
    if (!task)
      throw new NotFoundException(`Quiz for lesson ${lessonId} not found`);
    return task;
  }

  // The traps for this (user, task), or null when no completed attempt
  // exists to derive them from.
  //
  // Live questions are intersected with the recorded mistakes deliberately:
  // an author who deleted or replaced a question after the attempt would
  // otherwise leave a trap that can never be answered, and the stage could
  // never reach 100%.
  private async loadTraps(
    taskId: string,
    userId: string,
  ): Promise<{
    progressId: string | null;
    sourceAttemptId: string;
    state: TrapHunterState;
    questions: TrapQuestion[];
    wrongById: Map<string, unknown>;
  } | null> {
    const progress = await this.prisma.lessonTaskProgress.findUnique({
      where: { userId_taskId: { userId, taskId } },
    });
    if (!progress) return null;

    const wrongById = readWrongAnswers(progress.lastSubmitResult);
    if (!wrongById || !progress.lastClientAttemptId) return null;

    const questions =
      wrongById.size > 0
        ? ((await this.prisma.question.findMany({
            where: { id: { in: [...wrongById.keys()] }, taskId },
            orderBy: { orderIndex: 'asc' },
            select: TRAP_QUESTION_SELECT,
          })) as TrapQuestion[])
        : [];

    return {
      progressId: progress.id,
      sourceAttemptId: progress.lastClientAttemptId,
      state: readTrapState(
        progress.trapHunterState,
        progress.lastClientAttemptId,
      ),
      questions,
      wrongById,
    };
  }

  private static progressOf(
    questions: TrapQuestion[],
    state: TrapHunterState,
  ): TrapHunterProgressDto {
    const total = questions.length;
    const cleared = questions.filter(
      (question) => state.traps[question.id]?.clearedAt,
    ).length;
    return {
      hasSource: true,
      total,
      cleared,
      // An empty trap set is NOT a completed stage. A perfect quiz needed no
      // correction round at all — the frontend reports that as 'skipped',
      // an outcome the student earned, rather than a stage they finished.
      completed: total > 0 && cleared === total,
    };
  }

  // GET /lessons/:lessonId/trap-hunter
  async getTrapHunter(
    lessonId: string,
    userId: string,
  ): Promise<GetTrapHunterResponseDto> {
    const task = await this.findQuizTask(lessonId);
    const loaded = await this.loadTraps(task.id, userId);

    if (!loaded) {
      // No completed attempt yet. Not an error on a GET — the stage is
      // simply not reachable, and hasSource: false is what tells the client
      // to render "finish the quiz first" rather than "you made no
      // mistakes".
      return {
        traps: [],
        progress: {
          hasSource: false,
          total: 0,
          cleared: 0,
          completed: false,
        },
      };
    }

    const { state, questions, wrongById } = loaded;

    const traps: TrapDto[] = questions.map((question) => {
      const record = recordFor(state, question.id);
      const hints = buildTrapHints(asHintable(question));
      return {
        questionId: question.id,
        type: question.type,
        difficulty: question.difficulty,
        content: question.content,
        options: question.options as unknown as QuestionOption[] | null,
        audioUrl: question.audioUrl,
        imageUrl: question.imageUrl,
        wrongAnswer: wrongById.get(question.id) ?? null,
        attempts: record.attempts,
        hintLevel: record.hintLevel,
        hintsAvailable: hints.length,
        // Only the levels actually unlocked. A sealed trap (hintLevel 0)
        // gets an empty array — no explanation, no narrowing, nothing.
        hints: hints.slice(0, record.hintLevel),
        cleared: record.clearedAt
          ? {
              clearedAt: record.clearedAt,
              correctAnswer: question.correctAnswer,
              explanation: question.explanation,
            }
          : null,
      };
    });

    return { traps, progress: TrapHunterService.progressOf(questions, state) };
  }

  // POST /lessons/:lessonId/trap-hunter/answer
  //
  // Grades ONE correction with the unchanged pure gradeQuestion(), records
  // the outcome, and reveals the correct answer + authored explanation. A
  // wrong correction is not punished: it increments `attempts` (which only
  // ever drives a "Need a hint?" nudge on the client) and the trap stays in
  // the queue to come back later.
  async answerTrap(
    lessonId: string,
    userId: string,
    dto: AnswerTrapDto,
  ): Promise<AnswerTrapResponseDto> {
    const task = await this.findQuizTask(lessonId);
    const loaded = await this.loadTraps(task.id, userId);
    if (!loaded) throw new TrapHunterNotAvailableException();

    const question = loaded.questions.find((q) => q.id === dto.questionId);
    if (!question)
      throw new NotFoundException(
        `Question ${dto.questionId} is not one of your traps for this lesson`,
      );

    const totalCount = loaded.questions.length;

    return this.prisma.$transaction(async (tx) => {
      // Re-read inside the transaction: two tabs answering the same trap
      // must not clobber each other's records.
      const progress = await tx.lessonTaskProgress.findUnique({
        where: { userId_taskId: { userId, taskId: task.id } },
      });
      if (!progress?.lastClientAttemptId)
        throw new TrapHunterNotAvailableException();

      const state = readTrapState(
        progress.trapHunterState,
        progress.lastClientAttemptId,
      );
      const record = recordFor(state, question.id);

      const clearedCountOf = (s: TrapHunterState) =>
        loaded.questions.filter((q) => s.traps[q.id]?.clearedAt).length;

      if (record.clearedAt) {
        // Already corrected — replay verbatim, no re-grade and NO WRITE.
        // The same idempotent-replay contract POST /quiz/answer uses, and
        // the reason a double-click or a retried request can never inflate
        // an attempt count or reset a clear.
        const user = await tx.user.findUniqueOrThrow({
          where: { id: userId },
          select: { totalPoints: true },
        });
        return {
          questionId: question.id,
          isCorrect: true,
          correctAnswer: question.correctAnswer,
          explanation: question.explanation,
          attempts: record.attempts,
          clearedCount: clearedCountOf(state),
          totalCount,
          currentStreak: trailingCleanClearStreak(state),
          allCleared: clearedCountOf(state) >= totalCount,
          // Sprint 10 — a replay earns nothing. The current totals still come
          // back so the client's level widget stays right.
          gamification: noAward(user.totalPoints),
        };
      }

      const isCorrect = gradeQuestion(question, dto.submitted);
      const updated: TrapRecord = isCorrect
        ? { ...record, clearedAt: new Date().toISOString() }
        : { ...record, attempts: record.attempts + 1 };

      const nextState: TrapHunterState = {
        sourceAttemptId: state.sourceAttemptId,
        traps: { ...state.traps, [question.id]: updated },
      };

      await tx.lessonTaskProgress.update({
        where: { id: progress.id },
        // ONE FIELD. See the invariant at the top of this file — nothing
        // about the quiz's own score, attempt count or completion is
        // touched here, and no test-passing shortcut may add one.
        data: {
          trapHunterState: nextState as unknown as Prisma.InputJsonValue,
        },
      });

      // Sprint 10 — XP for the trap just cleared.
      //
      // countsAsActivity is FALSE, and that is a decision rather than an
      // oversight. The write above touches exactly one JSON column on
      // LessonTaskProgress, which carries no timestamp for it, so a trap clear
      // is invisible to the dashboard's activity scan
      // (shared/activity-window.ts) TODAY. Recording an activity day here would
      // start lighting up calendar tiles Sprint 09 does not — quietly changing
      // the streaks of students who have been using the product for weeks.
      // Trap Hunter earns XP; it does not create an active day.
      const gamification = await this.gamification.recordProgress(tx, userId, {
        at: new Date(),
        awards: isCorrect ? [trapClearedAward(task.id, question.id)] : [],
        countsAsActivity: false,
      });

      const clearedCount = clearedCountOf(nextState);
      return {
        questionId: question.id,
        isCorrect,
        correctAnswer: question.correctAnswer,
        explanation: question.explanation,
        attempts: updated.attempts,
        clearedCount,
        totalCount,
        currentStreak: trailingCleanClearStreak(nextState),
        allCleared: clearedCount >= totalCount,
        gamification,
      };
    });
  }

  // POST /lessons/:lessonId/trap-hunter/hint
  //
  // Unlocking a hint is recorded so a refresh restores what the student was
  // reading. That record has no other consumer: taking a hint never
  // prevents, delays or annotates clearing a trap. Trap Hunter evaluates
  // correction, not exam integrity.
  async requestHint(
    lessonId: string,
    userId: string,
    dto: RequestTrapHintDto,
  ): Promise<TrapHintResponseDto> {
    const task = await this.findQuizTask(lessonId);
    const loaded = await this.loadTraps(task.id, userId);
    if (!loaded) throw new TrapHunterNotAvailableException();

    const question = loaded.questions.find((q) => q.id === dto.questionId);
    if (!question)
      throw new NotFoundException(
        `Question ${dto.questionId} is not one of your traps for this lesson`,
      );

    const hints = buildTrapHints(asHintable(question));
    if (dto.level > hints.length)
      throw new TrapHintUnavailableException(dto.level, hints.length);

    return this.prisma.$transaction(async (tx) => {
      const progress = await tx.lessonTaskProgress.findUnique({
        where: { userId_taskId: { userId, taskId: task.id } },
      });
      if (!progress?.lastClientAttemptId)
        throw new TrapHunterNotAvailableException();

      const state = readTrapState(
        progress.trapHunterState,
        progress.lastClientAttemptId,
      );
      const record = recordFor(state, question.id);
      // max(), never assignment: re-requesting a level already unlocked
      // replays it rather than winding the ladder back down.
      const hintLevel = Math.max(record.hintLevel, dto.level);

      if (hintLevel !== record.hintLevel) {
        const nextState: TrapHunterState = {
          sourceAttemptId: state.sourceAttemptId,
          traps: { ...state.traps, [question.id]: { ...record, hintLevel } },
        };
        await tx.lessonTaskProgress.update({
          where: { id: progress.id },
          data: {
            trapHunterState: nextState as unknown as Prisma.InputJsonValue,
          },
        });
      }

      return {
        questionId: question.id,
        hints: hints.slice(0, hintLevel),
        hintLevel,
        hintsAvailable: hints.length,
      };
    });
  }

  // GET /courses/:courseId/trap-hunter-progress — one row per quiz-bearing
  // published lesson, so the course page needs one request instead of N.
  // Mirrors QuizService.getCourseQuizProgress exactly; it exists because
  // Sprint 06C makes trap state part of a lesson's completion, and without
  // it the course page would call a lesson complete while the lesson page
  // showed it open.
  async getCourseTrapHunterProgress(
    courseId: string,
    userId: string,
  ): Promise<CourseTrapHunterProgressRowDto[]> {
    await assertCourseAccessible(this.prisma, courseId);
    return this.collectCourseTrapProgress(courseId, userId);
  }

  // Sprint 06D — the access check is the CALLER's responsibility here, so the
  // aggregated stage-progress endpoint can verify the course once and roll up
  // several stages without repeating it per stage.
  //
  // Still keyed on the QUIZ task, and that is not an oversight: traps are
  // derived from a quiz attempt and from nothing else. Advanced Practice
  // mistakes deliberately do NOT feed this — see Sprint 06D's constraints.
  async collectCourseTrapProgress(
    courseId: string,
    userId: string,
  ): Promise<CourseTrapHunterProgressRowDto[]> {
    return this.collectTrapProgress({ kind: 'course', courseId }, userId);
  }

  // Sprint 07 — the same derivation over either a course or one lesson, so the
  // lesson aggregate reuses this rather than growing a second definition of
  // what a trap is. Still QUIZ-keyed, for the reason above.
  async collectTrapProgress(
    scope: ProgressScope,
    userId: string,
  ): Promise<CourseTrapHunterProgressRowDto[]> {
    const tasks = await this.prisma.lessonTask.findMany({
      where: {
        type: 'QUIZ',
        isPublished: true,
        ...scopeToTaskWhere(scope),
      },
      select: { id: true, lessonId: true },
    });
    if (tasks.length === 0) return [];

    const taskIds = tasks.map((task) => task.id);
    const [progressRows, questions] = await Promise.all([
      this.prisma.lessonTaskProgress.findMany({
        where: { userId, taskId: { in: taskIds } },
      }),
      // Only ids are needed here — this endpoint reports counts, never
      // content, so no correct answer is read on this path at all.
      this.prisma.question.findMany({
        where: { taskId: { in: taskIds } },
        select: { id: true, taskId: true },
      }),
    ]);

    const progressByTaskId = new Map(progressRows.map((p) => [p.taskId, p]));
    const liveIdsByTaskId = new Map<string, Set<string>>();
    for (const question of questions) {
      const set = liveIdsByTaskId.get(question.taskId) ?? new Set<string>();
      set.add(question.id);
      liveIdsByTaskId.set(question.taskId, set);
    }

    return tasks.map((task) => {
      const progress = progressByTaskId.get(task.id);
      const wrongById = progress
        ? readWrongAnswers(progress.lastSubmitResult)
        : null;

      if (!wrongById || !progress?.lastClientAttemptId) {
        return {
          lessonId: task.lessonId,
          hasSource: false,
          total: 0,
          cleared: 0,
        };
      }

      const liveIds = liveIdsByTaskId.get(task.id) ?? new Set<string>();
      const trapIds = [...wrongById.keys()].filter((id) => liveIds.has(id));
      const state = readTrapState(
        progress.trapHunterState,
        progress.lastClientAttemptId,
      );

      return {
        lessonId: task.lessonId,
        hasSource: true,
        total: trapIds.length,
        cleared: trapIds.filter((id) => state.traps[id]?.clearedAt).length,
      };
    });
  }
}
