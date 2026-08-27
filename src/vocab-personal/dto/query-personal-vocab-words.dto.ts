import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsTimeZone, Min } from 'class-validator';

// The mockup's 4 stat-card buckets collapse LearningState's 5 real values
// into 3 presentation buckets (`new` = NEW, `mastered` = MASTERED,
// `learning` = LEARNING | REVIEW | RELEARNING — anything past NEW but short
// of MASTERED reads as "đang học" to a student, who has no reason to see a
// RELEARNING/REVIEW distinction that only matters to the scheduler). Same
// bucketing PersonalVocabWordService.getStats uses, so the list filter and
// the stat cards it's driven from never disagree.
export type PersonalWordStatusFilter = 'all' | 'new' | 'learning' | 'mastered';
export const PERSONAL_WORD_STATUS_FILTERS: PersonalWordStatusFilter[] = [
  'all',
  'new',
  'learning',
  'mastered',
];

export type PersonalWordSort = 'newest' | 'oldest' | 'alphabetical';
export const PERSONAL_WORD_SORTS: PersonalWordSort[] = [
  'newest',
  'oldest',
  'alphabetical',
];

// Same {page,limit} shape as QueryVocabWordDto (vocab-word/dto) — matches
// this codebase's convention for a static (non-live-feed) list.
export class QueryPersonalVocabWordsDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  limit?: number;

  @IsString()
  @IsOptional()
  q?: string;

  @IsIn(PERSONAL_WORD_STATUS_FILTERS)
  @IsOptional()
  status?: PersonalWordStatusFilter;

  @IsString()
  @IsOptional()
  tag?: string;

  @IsIn(PERSONAL_WORD_SORTS)
  @IsOptional()
  sort?: PersonalWordSort;

  // Powers the sidebar's "Ôn tập hôm nay" -> "Bắt đầu ôn tập" action: the
  // SAME due-today definition GET /vocab-personal/stats' dueTodayCount
  // uses (nextReviewAt IS NULL OR < tomorrow's local midnight), so the
  // count and the actual session list can never disagree. `@Type(() =>
  // Boolean)` is deliberately NOT used — see QueryDueReviewsDto's identical
  // comment: it would make `?dueOnly=false` behave like `true`.
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  @IsOptional()
  dueOnly?: boolean;

  // Read-only, same role as GET /vocab-personal/stats' own `tz` — buckets
  // "due today" in the caller's zone without ever writing User.timezone.
  @IsTimeZone()
  @IsOptional()
  tz?: string;
}
