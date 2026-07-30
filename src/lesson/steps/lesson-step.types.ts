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
export interface LessonStepsDto {
  video: StepProgressDto | null;
  theory: StepProgressDto | null;
}
