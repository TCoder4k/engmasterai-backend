import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { CourseType, QuestionDifficulty, QuestionType } from '@prisma/client';
import { QuestionOptionDto } from '../../lesson/quiz/dto/question.dto';

// Mirrors UpsertQuestionDto's shape (src/lesson/quiz/dto/question.dto.ts) —
// same field-by-field validation style, same "correctAnswer's shape depends
// on type, so it's checked in the service via grade-question.ts's
// validateQuestionContent rather than here". QuestionOptionDto is reused
// directly rather than duplicated: it is already generic ({id, text}), not
// tied to LessonTask.
export class CreatePlacementQuestionDto {
  @IsEnum(CourseType)
  section: CourseType;

  @IsEnum(QuestionType)
  type: QuestionType;

  // Required here — unlike Question.difficulty, which is optional and
  // inert. POST /placement/start samples a fixed count per (section,
  // difficulty) bucket, so every question needs one.
  @IsEnum(QuestionDifficulty)
  difficulty: QuestionDifficulty;

  @IsString()
  @MinLength(1)
  content: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuestionOptionDto)
  options?: QuestionOptionDto[];

  // Shape is type-dependent — validated in the service.
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
