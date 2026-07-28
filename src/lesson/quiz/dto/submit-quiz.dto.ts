import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export class SubmitAnswerDto {
  @IsUUID()
  questionId: string;

  // Shape is type-dependent (see grade-question.ts's per-type Submission
  // types) — graded, not validated by decorator here. An unexpected shape
  // (stale client, hand-crafted request) grades as incorrect, never a 500.
  submitted: unknown;
}

// POST /lessons/:lessonId/quiz/submit. `clientAttemptId` is the idempotency
// key (same pattern as Sprint 04's SubmitReviewDto.clientReviewId) — a
// retried request with the same id and the same answers replays the
// original graded result rather than re-scoring or double-counting
// attemptsCount.
export class SubmitQuizDto {
  @IsUUID()
  clientAttemptId: string;

  // Optional as of Sprint 06B.5. Under IMMEDIATE feedback every answer was
  // already graded and recorded server-side by POST .../quiz/answer, so the
  // client has nothing left to report and submit carries only the attempt
  // id — anything sent here is IGNORED for scoring, deliberately: by then
  // the client has been told every correct answer and can no longer be
  // trusted to report its own. ON_SUBMIT still requires a non-empty array
  // (enforced in QuizService, same 400 as before), so existing clients are
  // unaffected.
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SubmitAnswerDto)
  answers?: SubmitAnswerDto[];
}
