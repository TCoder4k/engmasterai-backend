import { IsInt, IsUUID, Min } from 'class-validator';

// POST /lessons/:lessonId/trap-hunter/answer — Sprint 06C.
//
// Deliberately NO clientAttemptId, unlike AnswerQuestionDto. Which attempt a
// correction belongs to is not the client's to assert: traps are derived
// from the progress row's own `lastClientAttemptId`, so the server already
// knows, and accepting one would only create a way to disagree with it.
export class AnswerTrapDto {
  @IsUUID()
  questionId: string;

  // Shape is type-dependent (grade-question.ts's per-type Submission types)
  // and graded rather than decorator-validated, matching AnswerQuestionDto:
  // an unexpected shape grades as incorrect, never a 500.
  submitted: unknown;
}

// POST /lessons/:lessonId/trap-hunter/hint
//
// The level is explicit rather than "give me the next one" so a double-tap
// or a retried request cannot skip a rung: asking for a level you already
// have replays it, and asking for one that does not exist is refused.
export class RequestTrapHintDto {
  @IsUUID()
  questionId: string;

  @IsInt()
  @Min(1)
  level: number;
}
