import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

// Sprint 11 Phase 4B — the student write path for Shadowing.
//
// >>> READ WHAT IS NOT HERE <<<
// No `transcript`, no `accuracyPercent`, no `passed`, no `wordsCorrect`, no
// `xp`. The client uploads AUDIO and nothing else of consequence: it cannot
// declare what it said, let alone how well. This matters more than it did for
// Dictation — there, a cheat had to type the sentence correctly, which is the
// exercise. Here, a `transcript` field would let anyone submit perfect text
// and never speak at all.
//
// MULTIPART, SO EVERY FIELD ARRIVES AS A STRING. `@Transform` on the numeric
// field is not decoration: without it `durationMs` is `"4200"`, `@IsInt`
// rejects it, and the endpoint 400s on a well-formed request. The `audio` part
// itself is handled by `FileInterceptor` and is deliberately absent from this
// class — a DTO cannot validate a stream.
export class SubmitShadowingAttemptDto {
  /**
   * The idempotency key. Client-generated, per attempt.
   *
   * Checked BEFORE the speech engine is called, which is the difference that
   * matters here and did not for Dictation: transcription costs money and is
   * non-deterministic across providers. A replay must return the original
   * verdict, not buy a second opinion that disagrees with the first.
   */
  @IsUUID('4')
  clientAttemptId!: string;

  /**
   * How long the browser thinks the clip is.
   *
   * ADVISORY AND UNTRUSTED. Nothing is enforced with it — the real cap is the
   * upload byte size, which a client cannot misreport because the server
   * counts the bytes itself. It is stored because "the student submitted four
   * seconds of audio and was transcribed as silent" is a useful thing to be
   * able to see later.
   */
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' && value.trim() !== '' ? Number(value) : value,
  )
  @IsInt()
  @Min(0)
  @Max(120_000)
  durationMs?: number;
}

/**
 * Sprint 11 Phase 4C — asking for AI coaching on an attempt already graded.
 *
 * >>> READ WHAT IS NOT HERE, AGAIN <<<
 * No transcript, no reference sentence, no feedback text. The server looks up
 * BOTH from the attempt row it wrote itself; a client that could supply either
 * could put words in the coach's mouth, and a client that could supply the
 * feedback could put them on its own screen and call them ours.
 *
 * The only field is the key of an attempt this user already made, which is also
 * what makes the request idempotent: the answer is stored on that row, so a
 * second press returns the first answer rather than paying for another.
 */
export class RequestShadowingFeedbackDto {
  @IsUUID('4')
  clientAttemptId!: string;
}
