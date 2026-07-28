import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { QuestionDifficulty, QuestionType } from '@prisma/client';

// Sprint 06B — the admin whole-document quiz upsert (PUT
// /lessons/:lessonId/quiz). `options`/`correctAnswer` are not decorated
// beyond "an array"/"present" here — their shape depends on `type`, which
// class-validator has no clean way to express as a discriminated union.
// That business-rule validation (does correctAnswer match type? does every
// optionId referenced actually exist?) happens in QuizService via
// grade-question.ts's validateQuestionContent, which fails the whole save
// with a specific message rather than silently accepting malformed content.

export class QuestionOptionDto {
  @IsString()
  @MinLength(1)
  id: string;

  @IsString()
  @MinLength(1)
  text: string;
}

export class UpsertQuestionDto {
  // Present = update this existing question; absent = create a new one.
  // Any id from the current question set that is NOT present in the
  // submitted array is deleted — this is a whole-document upsert, not a
  // patch (see QuizService.upsertQuiz).
  @IsUUID()
  @IsOptional()
  id?: string;

  @IsEnum(QuestionType)
  type: QuestionType;

  @IsString()
  @MinLength(1)
  content: string;

  @IsOptional()
  @IsEnum(QuestionDifficulty)
  difficulty?: QuestionDifficulty;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuestionOptionDto)
  options?: QuestionOptionDto[];

  // Shape is type-dependent (see grade-question.ts) — validated in the
  // service, not here.
  correctAnswer: unknown;

  @IsOptional()
  @IsString()
  explanation?: string;

  @IsOptional()
  @IsString()
  audioUrl?: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;
}
