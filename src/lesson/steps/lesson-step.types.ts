import { LessonStepKind } from '@prisma/client';

// Sprint 07 — the wire shape for VIDEO and THEORY step progress.
//
// There is deliberately NO `status` field. The client derives it:
//   completedAt != null -> completed
//   startedAt   != null -> in progress
//   neither             -> not started
// Sending a status alongside the timestamps it is computed from would be a
// second representation of one fact, which is exactly how
// LessonTaskProgress.status came to disagree with completedAt (see the enum's
// note in schema.prisma).
export interface StepProgressDto {
  step: LessonStepKind;
  startedAt: string | null;
  completedAt: string | null;
  lastActivityAt: string;
  // VIDEO only — null on a THEORY row.
  highestPositionSeconds: number | null;
  videoDurationSeconds: number | null;
}

// Both steps for one lesson. A null means the student has no row for that step
// yet, which is NOT the same as "this lesson has no video": whether a step
// exists at all is decided by Lesson.videoUrl / Lesson.notes, which the client
// already holds.
// Sprint 10 — what a step WRITE endpoint returns.
//
// THE GAMIFICATION RESULT IS A SIBLING OF THE STEP, NEVER A FIELD ON IT, and
// this separation is the whole point of the type.
//
// StepProgressDto is not a write-endpoint DTO: `toDto` is exported and its
// output flows into LessonStepsDto -> LessonProgressDto and the course
// aggregate (lesson-progress.types.ts), which are pure READS. Hanging
// `xpAwarded` off it would leak XP into GET /lessons/:id/progress and
// GET /progress/courses, where it means nothing — and worse, those reads would
// then report an "award" on every page load.
//
// The controller merges the two at the edge. Same shape and same reason as
// TaskSubmitOutcome in the quiz engine.
export interface StepWriteOutcome {
  step: StepProgressDto;
  gamification: import('../../gamification/gamification.types').GamificationResultDto;
}

export interface LessonStepsDto {
  video: StepProgressDto | null;
  theory: StepProgressDto | null;
}
