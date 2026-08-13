import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { CefrLevel, LearningGoal } from '@prisma/client';

export class CreateVocabLibraryDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsString()
  @IsOptional()
  thumbnail?: string;

  // Personalized Roadmap — mirrors CreateCourseDto.level exactly. Optional:
  // a library authored before an admin sets this simply isn't a roadmap-
  // matching candidate yet.
  @IsEnum(CefrLevel)
  @IsOptional()
  level?: CefrLevel;

  // Personalized Roadmap — mirrors CreateCourseDto.suitableGoals exactly.
  // Omitted/empty means "eligible for every goal".
  @IsArray()
  @IsEnum(LearningGoal, { each: true })
  @IsOptional()
  suitableGoals?: LearningGoal[];
}
