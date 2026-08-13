import {
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { CefrLevel, LearningGoal } from '@prisma/client';

// Sprint 11 — admin category authoring.
//
// `isPublished` is absent from BOTH DTOs on purpose, exactly as it is absent
// from CreateCourseDto/UpdateCourseDto: publication state changes only through
// the dedicated publish/unpublish actions, so no general-purpose edit can flip
// a whole topic live by accident. The services construct their Prisma payloads
// field by field, so even the bare global ValidationPipe (main.ts sets no
// `whitelist`) cannot let an extra `isPublished` in the body reach a column.

export class CreateListeningCategoryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  /** Vietnamese label. Required — the student UI is bilingual, not English-first. */
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  nameVi!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  orderIndex?: number;

  // Personalized Roadmap — mirrors CreateCourseDto.level/suitableGoals
  // exactly. Optional: a category authored before an admin sets these
  // simply isn't a roadmap-matching candidate yet.
  @IsEnum(CefrLevel)
  @IsOptional()
  level?: CefrLevel;

  @IsArray()
  @IsEnum(LearningGoal, { each: true })
  @IsOptional()
  suitableGoals?: LearningGoal[];
}

export class UpdateListeningCategoryDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  nameVi?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  orderIndex?: number;

  @IsEnum(CefrLevel)
  @IsOptional()
  level?: CefrLevel;

  @IsArray()
  @IsEnum(LearningGoal, { each: true })
  @IsOptional()
  suitableGoals?: LearningGoal[];
}
