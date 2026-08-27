import { IsOptional, IsString } from 'class-validator';

// Read-only `tz` — same fallback role as LibrariesProgressQueryDto's `tz`
// (learning/dto): buckets "today" for dueTodayCount but never bootstraps
// User.timezone (only LearningService.getDueReviews owns that write).
export class QueryPersonalVocabStatsDto {
  @IsString()
  @IsOptional()
  tz?: string;
}
