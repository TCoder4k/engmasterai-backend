import { IsArray, IsEnum, IsOptional, IsString } from 'class-validator';
import { CefrLevel, LearningGoal } from '@prisma/client';

export class UpdateVocabLibraryDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  thumbnail?: string;

  @IsEnum(CefrLevel)
  @IsOptional()
  level?: CefrLevel;

  @IsArray()
  @IsEnum(LearningGoal, { each: true })
  @IsOptional()
  suitableGoals?: LearningGoal[];
}
