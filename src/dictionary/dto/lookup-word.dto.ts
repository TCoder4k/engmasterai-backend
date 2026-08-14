import { Transform } from 'class-transformer';
import { IsString, Length, Matches } from 'class-validator';

// Deliberately no field for a definition, a translation or a "found" flag —
// this is a lookup KEY, and the server decides everything else
// (dictionary.service.ts).
export class LookupWordQueryDto {
  // Trim + collapse internal whitespace BEFORE validation runs, so "  give   up "
  // and "give up" are the same query and an all-whitespace input fails
  // @Length(1, ...) honestly instead of passing as a non-empty string.
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value,
  )
  @IsString()
  @Length(1, 64)
  // 1–3 space-separated tokens (catches common collocations like "give up"),
  // each token letters/apostrophe/hyphen only — rejects digits/symbols with
  // an honest 400 rather than passing them through to a lookup that would
  // just 404. A misspelled real word still passes this filter; that is an
  // ordinary "not found" case, not a validation error.
  @Matches(/^[A-Za-z'-]+(?: [A-Za-z'-]+){0,2}$/, {
    message:
      'q must be 1-3 words using only English letters, apostrophes and hyphens',
  })
  q!: string;
}
