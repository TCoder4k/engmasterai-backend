import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';

// A prefix, not a lookup key: deliberately looser than LookupWordQueryDto's
// "1-3 complete words" pattern — the student is mid-word ("giv") or mid-phrase
// ("give u"), so trailing partial tokens must validate too.
export class SuggestWordQueryDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value,
  )
  @IsString()
  @Length(2, 64)
  @Matches(/^[A-Za-z'-]+(?: [A-Za-z'-]*)*$/, {
    message:
      'q must start with English letters (apostrophes/hyphens/spaces allowed) and be at least 2 characters',
  })
  q!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  limit?: number;
}
