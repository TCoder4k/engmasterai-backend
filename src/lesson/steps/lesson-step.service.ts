import { Injectable, NotFoundException } from '@nestjs/common';
import { LessonStepKind, LessonStepProgress, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GamificationService } from '../../gamification/gamification.service';
import { stageAward } from '../../gamification/xp-rules';
import { assertLessonVisible } from '../quiz/lesson-visibility';
import { ProgressScope, scopeToLessonWhere } from '../quiz/progress-scope';
import { VideoProgressDto } from './dto/video-progress.dto';
import {
  LessonStepsDto,
  StepProgressDto,
  StepWriteOutcome,
} from './lesson-step.types';

// A lesson the student has never opened. Returned rather than null so callers
// never have to distinguish "no rows" from "no lesson".
export const EMPTY_STEPS: LessonStepsDto = { video: null, theory: null };

// The share of a video that must have been reached for the step to count as
// finished. Product decision (Sprint 07): there is NO anti-seek rule —
// dragging the scrubber to the end completes the step, the same way most
// LMS players behave.
const VIDEO_COMPLETION_RATIO = 0.9;

// A completion floor for the DENOMINATOR, not for the student's behaviour.
//
// This is not anti-seek by the back door. `durationSeconds` is client-supplied
// and `Lesson.videoDurationMinutes` is nullable (so most lessons have no
// authored length to check against), which means a first-ever report of
// {positionSeconds: 1, durationSeconds: 1} would otherwise complete any video
// instantly — 1/1 >= 0.9. Freezing the denominator (see below) closes that
// only once an honest report has landed first; this closes it from the start.
//
// 30s is far below any real lesson video — the roadmap specifies 5-7 minutes —
// so no genuine content is affected. Progress is still recorded below the
// floor; only completion is withheld.
const MIN_COMPLETABLE_DURATION_SECONDS = 30;

@Injectable()
export class LessonStepService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gamification: GamificationService,
  ) {}

  // Read-only. Never creates a row: describing a step the student has never
  // touched must not make it look touched, and the lesson page reads this on
  // every visit.
  async readSteps(lessonId: string, userId: string): Promise<LessonStepsDto> {
    await assertLessonVisible(this.prisma, lessonId);
    const byLesson = await this.collectSteps(
      { kind: 'lesson', lessonId },
      userId,
    );
    return byLesson.get(lessonId) ?? EMPTY_STEPS;
  }

  // Batch reader for the aggregates, over either one lesson or a whole course.
  // ONE query at either scope — a course with 200 lessons costs the same as a
  // course with 2, which is what keeps the course page free of an N+1.
  //
  // Visibility is the CALLER's responsibility here, matching the convention
  // QuizService.collectTaskProgress and TrapHunterService.collectTrapProgress
  // already follow, so an aggregate can check once and roll up many stages.
  async collectSteps(
    scope: ProgressScope,
    userId: string,
  ): Promise<Map<string, LessonStepsDto>> {
    // Sprint 08 — the scope predicate moved to scopeToLessonWhere so this
    // collector, the task collectors and the course aggregate's own lesson
    // query all agree on what a scope selects. A lesson counted by one and
    // missed by another is a silent percentage bug.
    const rows = await this.prisma.lessonStepProgress.findMany({
      where: { userId, lesson: scopeToLessonWhere(scope) },
    });

    const byLesson = new Map<string, LessonStepProgress[]>();
    for (const row of rows) {
      const list = byLesson.get(row.lessonId) ?? [];
      list.push(row);
      byLesson.set(row.lessonId, list);
    }

    return new Map(
      [...byLesson].map(([lessonId, list]) => [lessonId, toStepsDto(list)]),
    );
  }

  // Idempotent: repeat calls return the same startedAt rather than restamping.
  // Fired when the theory pane opens, so it runs on every visit to a lesson
  // the student has already read.
  async startTheory(
    lessonId: string,
    userId: string,
  ): Promise<StepWriteOutcome> {
    const lesson = await this.assertStepAvailable(
      lessonId,
      LessonStepKind.THEORY,
    );
    return this.upsertStep(userId, lesson.id, LessonStepKind.THEORY, {
      start: true,
      complete: false,
    });
  }

  // The explicit "Tôi đã đọc xong" action — the ONLY thing that completes
  // theory. Also stamps startedAt, so completing without a prior start (a
  // client that skipped the start call, or a race between the two) still
  // yields a coherent row rather than one that is complete but never started.
  async completeTheory(
    lessonId: string,
    userId: string,
  ): Promise<StepWriteOutcome> {
    const lesson = await this.assertStepAvailable(
      lessonId,
      LessonStepKind.THEORY,
    );
    return this.upsertStep(userId, lesson.id, LessonStepKind.THEORY, {
      start: true,
      complete: true,
    });
  }

  async recordVideoProgress(
    lessonId: string,
    userId: string,
    dto: VideoProgressDto,
  ): Promise<StepWriteOutcome> {
    const lesson = await this.assertStepAvailable(
      lessonId,
      LessonStepKind.VIDEO,
    );
    return this.writeVideoProgress(lesson, userId, dto);
  }

  // Separated so the whole read-then-write can be retried as a unit.
  //
  // The player awaits each post, so overlapping writes to one row are
  // uncommon — but a pause flush landing on top of an in-flight interval tick
  // can do it, and then both calls see no row and both try to create one. The
  // loser gets a P2002. Retrying re-reads inside a fresh transaction and takes
  // the update branch, which is exactly what it would have done had the two
  // been sequential. Retried ONCE: a second collision means something other
  // than a benign race.
  private async writeVideoProgress(
    lesson: { id: string; videoDurationMinutes: number | null },
    userId: string,
    dto: VideoProgressDto,
    isRetry = false,
  ): Promise<StepWriteOutcome> {
    try {
      return await this.videoProgressTransaction(lesson, userId, dto);
    } catch (error) {
      if (
        !isRetry &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return this.writeVideoProgress(lesson, userId, dto, true);
      }
      throw error;
    }
  }

  private async videoProgressTransaction(
    lesson: { id: string; videoDurationMinutes: number | null },
    userId: string,
    dto: VideoProgressDto,
  ): Promise<StepWriteOutcome> {
    // An author's stated length beats anything the client reports. Stored in
    // whole minutes, so the 90% gate is accurate to within ~30s — acceptable,
    // and documented rather than silently assumed.
    const authoredSeconds =
      lesson.videoDurationMinutes && lesson.videoDurationMinutes > 0
        ? lesson.videoDurationMinutes * 60
        : null;

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.lessonStepProgress.findUnique({
        where: {
          userId_lessonId_step: {
            userId,
            lessonId: lesson.id,
            step: LessonStepKind.VIDEO,
          },
        },
      });

      // WRITE-ONCE. The first report that carries a duration fixes it; every
      // later report is measured against that same number, so a client cannot
      // shrink the denominator after the fact to manufacture 90%.
      const frozenSeconds =
        existing?.videoDurationSeconds ?? dto.durationSeconds;
      const denominator = authoredSeconds ?? frozenSeconds;

      // Clamped, so a position past the end cannot inflate the ratio and a
      // negative one cannot poison the monotonic maximum below.
      const clamped = Math.min(
        Math.max(dto.positionSeconds, 0),
        dto.durationSeconds,
      );
      const highest = Math.max(existing?.highestPositionSeconds ?? 0, clamped);

      const canComplete =
        denominator >= MIN_COMPLETABLE_DURATION_SECONDS &&
        highest / denominator >= VIDEO_COMPLETION_RATIO;

      const now = new Date();

      // Sprint 10 — XP is due only on the transition into completion. Reuses
      // the exact expression this method already computed to decide whether to
      // stamp completedAt, rather than re-deriving it: one condition, one
      // meaning. `existing.completedAt` is never cleared, so rewatching a
      // finished video takes the `false` branch forever.
      const justCompleted = !existing?.completedAt && canComplete;

      const row = existing
        ? await tx.lessonStepProgress.update({
            where: { id: existing.id },
            data: {
              startedAt: existing.startedAt ?? now,
              // `??` and never a bare assignment: rewatching a finished video
              // must not restamp its completion, and nothing may ever clear it.
              completedAt: existing.completedAt ?? (canComplete ? now : null),
              lastActivityAt: now,
              highestPositionSeconds: highest,
              videoDurationSeconds:
                existing.videoDurationSeconds ?? frozenSeconds,
            },
          })
        : await tx.lessonStepProgress.create({
            data: {
              userId,
              lessonId: lesson.id,
              step: LessonStepKind.VIDEO,
              startedAt: now,
              completedAt: canComplete ? now : null,
              lastActivityAt: now,
              highestPositionSeconds: highest,
              videoDurationSeconds: frozenSeconds,
            },
          });

      // ORDERING INVARIANT: the step row above is written FIRST, then activity,
      // then the streak. countCurrentStreak counts from yesterday when today
      // looks empty, so evaluating before this write would report a streak one
      // day short and deliver the 3-day badge on day four.
      //
      // `knownLastActivityAt` is the hot-path saver: a 10-minute video posts
      // ~86 of these, and if the row we just read was already stamped today
      // there is no activity row to create.
      const gamification = await this.gamification.recordProgress(tx, userId, {
        at: now,
        awards: justCompleted
          ? [stageAward(lesson.id, LessonStepKind.VIDEO)]
          : [],
        countsAsActivity: true,
        knownLastActivityAt: existing?.lastActivityAt ?? null,
      });

      return { step: toDto(row), gamification };
    });
  }

  // Same 404 whether the lesson is missing, unpublished, in an unpublished
  // course, or simply has no content for this step — the anti-probing rule the
  // quiz surface already follows (see lesson-visibility.ts).
  private async assertStepAvailable(lessonId: string, step: LessonStepKind) {
    await assertLessonVisible(this.prisma, lessonId);
    const lesson = await this.prisma.lesson.findUnique({
      where: { id: lessonId },
      select: {
        id: true,
        videoUrl: true,
        notes: true,
        videoDurationMinutes: true,
      },
    });
    if (!lesson) throw new NotFoundException(`Lesson ${lessonId} not found`);

    // Refusing here keeps junk rows out of the table: a step that does not
    // exist on this lesson can never be started or completed, so it can never
    // appear in a completion calculation.
    const hasContent =
      step === LessonStepKind.VIDEO
        ? Boolean(lesson.videoUrl?.trim())
        : Boolean(lesson.notes?.trim());
    if (!hasContent) {
      throw new NotFoundException(`Lesson ${lessonId} has no ${step} step`);
    }
    return lesson;
  }

  private async upsertStep(
    userId: string,
    lessonId: string,
    step: LessonStepKind,
    action: { start: boolean; complete: boolean },
  ): Promise<StepWriteOutcome> {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.lessonStepProgress.findUnique({
        where: { userId_lessonId_step: { userId, lessonId, step } },
      });

      // Sprint 10 — the completion TRANSITION, not the completion state.
      // Reopening finished theory calls this with complete: true every time,
      // and `existing.completedAt` is never cleared, so this is true exactly
      // once in an account's life for a given lesson-step.
      const justCompleted = !existing?.completedAt && action.complete;

      const row = existing
        ? await tx.lessonStepProgress.update({
            where: { id: existing.id },
            data: {
              startedAt: existing.startedAt ?? (action.start ? now : null),
              completedAt:
                existing.completedAt ?? (action.complete ? now : null),
              lastActivityAt: now,
            },
          })
        : await tx.lessonStepProgress.create({
            data: {
              userId,
              lessonId,
              step,
              startedAt: action.start ? now : null,
              completedAt: action.complete ? now : null,
              lastActivityAt: now,
            },
          });

      // After the step write — see the ordering note in videoProgressTransaction.
      const gamification = await this.gamification.recordProgress(tx, userId, {
        at: now,
        awards: justCompleted ? [stageAward(lessonId, step)] : [],
        countsAsActivity: true,
        knownLastActivityAt: existing?.lastActivityAt ?? null,
      });

      return { step: toDto(row), gamification };
    });
  }
}

// Exported so the aggregate readers (LessonProgressService, and the course
// aggregate in PracticeService) map rows exactly the same way this module
// does — one shape, one place.
export const toDto = (row: LessonStepProgress): StepProgressDto => ({
  step: row.step,
  startedAt: row.startedAt?.toISOString() ?? null,
  completedAt: row.completedAt?.toISOString() ?? null,
  lastActivityAt: row.lastActivityAt.toISOString(),
  highestPositionSeconds: row.highestPositionSeconds,
  videoDurationSeconds: row.videoDurationSeconds,
});

export const toStepsDto = (rows: LessonStepProgress[]): LessonStepsDto => {
  const video = rows.find((r) => r.step === LessonStepKind.VIDEO);
  const theory = rows.find((r) => r.step === LessonStepKind.THEORY);
  return {
    video: video ? toDto(video) : null,
    theory: theory ? toDto(theory) : null,
  };
};
