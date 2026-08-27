import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';

// Matches CreateVocabWordDto's (vocab-word/dto) class-validator conventions.
// No `cefrLevel`/`partOfSpeech`/nested meanings array here — a personal word
// is one flat row (see the PersonalVocabWord model comment), and the mockup's
// single-add modal collects exactly these fields, auto-filled from
// /dictionary/lookup but always still editable before save.
export class CreatePersonalVocabWordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  text: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  ipa?: string;

  // Required, unlike VocabWord's meanings array — a personal word always has
  // at least the student's own understanding of it; that's the entire point
  // of saving it. English meaning is optional (not every dictionary hit has
  // one, and the mockup's manual-entry flow never asks for it).
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  meaningVi: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  meaningEn?: string;

  @IsUrl({ protocols: ['https'] })
  @IsOptional()
  audioUrl?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  exampleSentence?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  exampleTranslation?: string;

  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(30, { each: true })
  @IsOptional()
  tags?: string[];
}
