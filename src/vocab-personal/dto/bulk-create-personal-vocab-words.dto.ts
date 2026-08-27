import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, ValidateNested } from 'class-validator';
import { CreatePersonalVocabWordDto } from './create-personal-vocab-word.dto';

// The frontend has already done the throttled /dictionary/lookup calls for
// every pasted line by the time this hits the backend (see
// ImportPersonalWordsModal) — this endpoint only persists already-resolved
// records. `@ArrayMaxSize(200)` bounds ONE request; it is unrelated to "no
// limit on personal words" (a total-per-account non-limit), matching this
// codebase's existing bulk-array convention (ArrayMaxSize(100) on
// attach-vocab-deck-words.dto.ts, ArrayMaxSize(500) on
// upsert-listening-segments.dto.ts).
export class BulkCreatePersonalVocabWordsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => CreatePersonalVocabWordDto)
  words: CreatePersonalVocabWordDto[];
}
