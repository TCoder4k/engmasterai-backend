import { IsUUID } from 'class-validator';

// POST /lessons/:lessonId/quiz/answer — Sprint 06B.5, IMMEDIATE feedback
// mode only.
//
// `clientAttemptId` identifies which attempt this answer belongs to, not
// (as on SubmitQuizDto) an idempotency key for a single request: when it
// differs from the attempt currently on record, the server treats it as a
// fresh attempt and clears the previous in-flight answers. Idempotency for
// THIS endpoint is inherent instead — a question that already has a
// recorded answer replays that answer verbatim and is never re-graded, so a
// double-click or a retried request cannot change a score.
export class AnswerQuestionDto {
  @IsUUID()
  clientAttemptId: string;

  @IsUUID()
  questionId: string;

  // Shape is type-dependent (see grade-question.ts's per-type Submission
  // types) — graded, not validated by decorator here. An unexpected shape
  // (stale client, hand-crafted request) grades as incorrect, never a 500.
  submitted: unknown;
}
