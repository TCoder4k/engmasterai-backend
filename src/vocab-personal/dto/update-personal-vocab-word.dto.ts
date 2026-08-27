import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  ValidateIf,
} from 'class-validator';

// Same null-vs-undefined convention as UpdateVocabWordDto (vocab-word/dto):
// omitting a key means "leave unchanged" everywhere; an explicit `null` is
// only accepted on genuinely-nullable columns (clears them), and rejected
// with a 400 on non-nullable ones (`text`, `meaningVi`, `tags`) rather than
// reaching Prisma as an impossible write.
//
// `text` is intentionally editable here (unlike VocabWord's admin editor,
// where renaming a shared word would affect every user reviewing it) — a
// personal word has exactly one owner, so a rename is a private correction,
// not a shared-data hazard. Renaming still recomputes `textNormalized` and
// is still subject to the @@unique([userId, textNormalized]) constraint —
// VocabPersonalService.update surfaces a collision as a 409, same shape as
// bulk import's dedup.
export class UpdatePersonalVocabWordDto {
  @ValidateIf((o) => o.text !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  text?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  ipa?: string | null;

  @ValidateIf((o) => o.meaningVi !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  meaningVi?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  meaningEn?: string | null;

  @IsOptional()
  @IsUrl({ protocols: ['https'] })
  audioUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  exampleSentence?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  exampleTranslation?: string | null;

  @ValidateIf((o) => o.tags !== undefined)
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(30, { each: true })
  tags?: string[];
}
