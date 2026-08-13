import { IsArray, IsEnum, IsOptional, IsString } from 'class-validator';
import { CefrLevel, CourseType, LearningGoal } from '@prisma/client';

export class UpdateCourseDto {
  @IsString()
  @IsOptional()
  title?: string;

  @IsEnum(CourseType)
  @IsOptional()
  type?: CourseType;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  thumbnail?: string;

  @IsEnum(CefrLevel)
  @IsOptional()
  level?: CefrLevel;

  // See CreateCourseDto's own comment — same field, same semantics.
  @IsArray()
  @IsEnum(LearningGoal, { each: true })
  @IsOptional()
  suitableGoals?: LearningGoal[];
}
