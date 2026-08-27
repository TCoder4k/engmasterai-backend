import { IsEnum, IsUUID } from 'class-validator';
import { ReviewRating } from '@prisma/client';

// Same idempotency-key contract as SubmitReviewDto (learning/dto):
// clientReviewId is required, not a nice-to-have correlation id — see
// VocabPersonalService.submitReview's replay handling. No `practiceMode`
// or `sessionId`/`responseTimeMs` fields — those exist on the curated-deck
// review for analytics this feature has no equivalent use for yet; adding
// them later is a additive, backward-compatible DTO change, not a breaking
// one.
export class SubmitPersonalWordReviewDto {
  @IsEnum(ReviewRating)
  rating: ReviewRating;

  @IsUUID()
  clientReviewId: string;
}
