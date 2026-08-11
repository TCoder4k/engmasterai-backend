import { IsUUID } from 'class-validator';

// POST /placement/attempt/:attemptId/answer
export class AnswerPlacementQuestionDto {
  @IsUUID()
  questionId: string;

  // Shape is type-dependent (see grade-question.ts's per-type Submission
  // types) — graded at finalize time, never validated here. An unexpected
  // shape (stale client, hand-crafted request) grades as incorrect, never a
  // 500.
  submitted: unknown;
}
