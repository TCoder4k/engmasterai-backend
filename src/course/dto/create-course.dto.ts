import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { CefrLevel, CourseType } from '@prisma/client';

export class CreateCourseDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsEnum(CourseType)
  @IsNotEmpty()
  type: CourseType;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsString()
  @IsOptional()
  thumbnail?: string;

  // Personalized Onboarding & Placement Test — lets the roadmap algorithm
  // match a placement result's weak sections to an appropriately-leveled
  // course. Optional: a course authored before an admin sets this simply
  // isn't a roadmap-matching candidate yet.
  @IsEnum(CefrLevel)
  @IsOptional()
  level?: CefrLevel;
}
