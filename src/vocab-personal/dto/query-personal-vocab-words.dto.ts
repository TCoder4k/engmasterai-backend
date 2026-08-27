import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

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
}
