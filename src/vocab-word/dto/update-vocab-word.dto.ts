import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { CefrLevel } from '@prisma/client';
import {
  CreateVocabWordMeaningDto,
  CreateVocabWordExampleDto,
} from './create-vocab-word.dto';

// Null-vs-undefined convention (the H1 fix — see the approved Phase 2 plan §7):
//
// `@IsOptional()` skips ALL validators when a value is explicitly `null`, not
// just when it's absent. That is only safe on fields that are genuinely
// nullable at the DB level — using it on a non-nullable field would let a
// client send `{ "text": null }`, pass validation, and crash Prisma with a
// 500 when the service forwards it as a write.
//
// So this DTO is split in two:
//  - Nullable, clearable fields (ipa/audioUrl/imageUrl/cefrLevel) keep
//    `@IsOptional()` — explicit `null` passes validation and clears the
//    field; omitting the key means "leave unchanged".
//  - Everything else (text, and every array — Prisma doesn't support
//    nullable list columns) uses `@ValidateIf((o) => o.field !== undefined)`
//    instead: omitting the key still means "leave unchanged", but an
//    explicit `null` now fails validation and returns 400 rather than
//    reaching Prisma as an impossible write. Clearing an array means
//    sending `[]`, not `null`.
export class UpdateVocabWordDto {
  @ValidateIf((o) => o.text !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  text?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  ipa?: string | null;

  @IsOptional()
  @IsUrl({ protocols: ['https'] })
  audioUrl?: string | null;

  @IsOptional()
  @IsUrl({ protocols: ['https'] })
  imageUrl?: string | null;

  @IsOptional()
  @IsEnum(CefrLevel)
  cefrLevel?: CefrLevel | null;

  @ValidateIf((o) => o.synonyms !== undefined)
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  synonyms?: string[];

  @ValidateIf((o) => o.antonyms !== undefined)
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  antonyms?: string[];

  @ValidateIf((o) => o.collocations !== undefined)
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  collocations?: string[];

  @ValidateIf((o) => o.wordFamily !== undefined)
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  wordFamily?: string[];

  // Replace-all semantics: when provided, the word's entire meanings/examples
  // collection is deleted and recreated from this array (see
  // VocabWordService.update). Reuses the Create nested DTOs verbatim since a
  // replace-all item is fully-specified, not a partial patch.
  @ValidateIf((o) => o.meanings !== undefined)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => CreateVocabWordMeaningDto)
  meanings?: CreateVocabWordMeaningDto[];

  @ValidateIf((o) => o.examples !== undefined)
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => CreateVocabWordExampleDto)
  examples?: CreateVocabWordExampleDto[];
}
