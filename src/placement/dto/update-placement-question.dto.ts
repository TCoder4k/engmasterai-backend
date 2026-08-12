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

// PATCH /placement/questions/manage/:id — every field optional, only the
// ones present are written (see PlacementQuestionService.update).
export class UpdatePlacementQuestionDto {
  @IsOptional()
  @IsEnum(CourseType)
  section?: CourseType;

  @IsOptional()
  @IsEnum(QuestionType)
  type?: QuestionType;

  @IsOptional()
  @IsEnum(QuestionDifficulty)
  difficulty?: QuestionDifficulty;

  @IsOptional()
  @IsString()
  @MinLength(1)
  content?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuestionOptionDto)
  options?: QuestionOptionDto[];

  @IsOptional()
  correctAnswer?: unknown;

  @IsOptional()
  @IsString()
  explanation?: string;

  @IsOptional()
  @IsString()
  audioUrl?: string;

  @IsOptional()
  @IsString()
  transcript?: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;
}
