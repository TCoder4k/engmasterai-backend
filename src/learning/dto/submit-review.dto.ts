import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { ReviewRating, PracticeSource } from '@prisma/client';

// Matches CreateVocabWordDto's class-validator conventions. clientReviewId
// is required, not optional — it is the idempotency key (sprint plan §9/
// §10), not a nice-to-have correlation id.
export class SubmitReviewDto {
  @IsEnum(ReviewRating)
  rating: ReviewRating;

  @IsEnum(PracticeSource)
  practiceMode: PracticeSource;

  // Client correlation id — analytics only, never trusted for scheduling
  // or idempotency (that's clientReviewId, below).
  @IsUUID()
  @IsOptional()
  sessionId?: string;

  // Capped at 5 minutes — guards against fabricated/absurd client
  // timestamps (sprint plan §19). Persisted (§5) but never influences
  // scheduling.
  @IsInt()
  @Min(0)
  @Max(300000)
  @IsOptional()
  responseTimeMs?: number;

  @IsUUID()
  clientReviewId: string;
}
