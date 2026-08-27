import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsString, MaxLength } from 'class-validator';

// GET /vocab-personal/words/status?texts=apple,banana — batch "is this word
// already saved" check. Powers the universal save-star (DictionaryPanel,
// DeckDetailPage, WordDetailPage, FlashcardSession, ...): a page batch-checks
// its own word list ONCE instead of one request per row.
//
// `texts` arrives as ONE comma-separated query string — this codebase has no
// existing convention for a repeated-key array query param, and a single
// string keeps the URL simple for a caller batching 20-50 words. Split/
// trimmed/de-emptied here into a real array before per-element validation
// runs. `@ArrayMaxSize(100)` bounds ONE request (a page's own word list),
// same "bound the request, not the total store" reasoning as
// BulkCreatePersonalVocabWordsDto's `@ArrayMaxSize(200)` — unrelated to "no
// limit on personal words".
export class QueryPersonalVocabWordsStatusDto {
  @Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    return value
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
  })
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  texts: string[];
}
