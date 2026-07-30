import { IsInt, Max, Min } from 'class-validator';

// Sprint 07 — the body of POST /lessons/:lessonId/steps/video/progress.
//
// Both bounds matter. Without @IsInt these arrive as whatever JSON.parse
// produced, so NaN, Infinity and negatives reach Math.max() and the
// completion division — NaN >= 0.9 is false so it would fail silently rather
// than loudly, and a negative position would poison the monotonic maximum
// permanently.
//
// The 24-hour ceiling is a sanity bound, not a product rule: no lesson video
// is a day long, and it keeps a nonsense duration from being frozen into
// videoDurationSeconds (which is write-once) by the first report.
export class VideoProgressDto {
  // Clamped server-side to [0, duration] as well — validation bounds the
  // input, the service bounds the meaning.
  @IsInt()
  @Min(0)
  @Max(86_400)
  positionSeconds: number;

  // Min(1), not Min(0): zero would be a divide-by-zero in the completion
  // check, and a video of length zero is not a thing a student can watch.
  @IsInt()
  @Min(1)
  @Max(86_400)
  durationSeconds: number;
}
