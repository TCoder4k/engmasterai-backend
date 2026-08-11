import { IsEnum, IsOptional, IsString } from 'class-validator';
import { CefrLevel, CourseType } from '@prisma/client';

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
}
