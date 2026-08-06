import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

// Sprint 11 Phase 4A — the student write path for Dictation.
//
// >>> READ WHAT IS NOT HERE <<<
// There is no `accuracyPercent`, no `wordsCorrect`, no `wordsTotal`, no
// `solved` and no `xp`. A client cannot declare its own score because the
// shape to declare it in does not exist — and that is the guarantee, not the
// `ValidationPipe`, which runs bare in this app (no `whitelist`), so unknown
// properties survive on `req.body`. The service reads only the three fields
// below; everything else is computed from the stored reference sentence.
export class SubmitDictationAttemptDto {
  /**
   * The idempotency key. Client-generated, per attempt.
   *
   * Enforced by `@@unique([userId, clientAttemptId])` at the DATABASE level,
   * not by a compare-and-replay against the last attempt — a retry from two
   * attempts ago must still replay its own original result rather than being
   * mistaken for a fresh submission.
   */
  @IsUUID('4')
  clientAttemptId!: string;

  /**
   * Exactly what the student typed. Normalised server-side.
   *
   * The cap is generous rather than tight: a sentence is at most a few
   * hundred characters, and a student who pastes their whole notes should get
   * a low score, not a 400. It exists to bound the append-only column.
   */
  @IsString()
  @MaxLength(2000)
  typedText!: string;

  /**
   * How many words the student revealed with a hint.
   *
   * Untrusted, and safe to be: the service clamps it to the sentence length
   * and it can only ever REDUCE `wordsCorrect`. There is no direction in
   * which this value lies upward.
   */
  @IsInt()
  @Min(0)
  @Max(500)
  revealedWordCount!: number;
}

/**
 * Batch progress read for the catalog.
 *
 * `ArrayMaxSize(20)` matches `CourseProgressQueryDto` — the same page-sized
 * bound, for the same reason: an unbounded id list is an unbounded query.
 */
export class QueryListeningProgressDto {
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean)
      : value,
  )
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(20)
  @IsUUID(undefined, { each: true })
  contentIds!: string[];
}
