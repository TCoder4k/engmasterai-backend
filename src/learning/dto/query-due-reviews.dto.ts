import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsTimeZone, IsUUID, Max, Min } from 'class-validator';

// Same reasoning as every other list/query DTO in this codebase: the
// app-wide ValidationPipe (main.ts) doesn't enable `transform`, so the
// controller scopes one locally to this query (see vocab-word.controller.ts).
export class QueryDueReviewsDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200) // hard server cap — sprint plan §8/§24
  @IsOptional()
  limit?: number;

  @IsUUID()
  @IsOptional()
  deckId?: string;

  @IsUUID()
  @IsOptional()
  libraryId?: string;

  // @Type(() => Boolean) is NOT used here deliberately — class-transformer's
  // Boolean() coercion treats the literal string "false" as truthy (any
  // non-empty string is truthy), which would make ?includeNew=false behave
  // identically to true. This Transform parses the actual query value.
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  @IsOptional()
  includeNew?: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(50) // hard server cap — sprint plan §8/§24
  @IsOptional()
  newLimit?: number;

  // One-time bootstrap only — see LearningService.getDueReviews. Never
  // re-applied to an already-set User.timezone (sprint plan §8/§16),
  // closing the "reset my daily quota by spoofing tz" gap.
  @IsTimeZone()
  @IsOptional()
  tz?: string;
}
