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
  ValidateNested,
} from 'class-validator';
import { CefrLevel, PartOfSpeech } from '@prisma/client';

export class CreateVocabWordMeaningDto {
  @IsEnum(PartOfSpeech)
  @IsOptional()
  partOfSpeech?: PartOfSpeech;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  meaning: string;
}

export class CreateVocabWordExampleDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  sentence: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  translation?: string;
}

// A word is never created without at least one meaning — an entry with zero
// meanings is useless to every consumer (dictionary, flashcards, import).
export class CreateVocabWordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  text: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  ipa?: string;

  @IsUrl({ protocols: ['https'] })
  @IsOptional()
  audioUrl?: string;

  @IsUrl({ protocols: ['https'] })
  @IsOptional()
  imageUrl?: string;

  @IsEnum(CefrLevel)
  @IsOptional()
  cefrLevel?: CefrLevel;

  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  @IsOptional()
  synonyms?: string[];

  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  @IsOptional()
  antonyms?: string[];

  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  @IsOptional()
  collocations?: string[];

  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  @IsOptional()
  wordFamily?: string[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => CreateVocabWordMeaningDto)
  meanings: CreateVocabWordMeaningDto[];

  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => CreateVocabWordExampleDto)
  @IsOptional()
  examples?: CreateVocabWordExampleDto[];
}
