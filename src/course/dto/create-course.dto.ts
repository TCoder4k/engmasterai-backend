import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { CefrLevel, CourseType, LearningGoal } from '@prisma/client';

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

  // Personalized Onboarding & Placement Test — which goals this course is a
  // roadmap candidate for. Omitted/empty means "eligible for every goal",
  // matching Course.suitableGoals's own default — a course authored before
  // an admin tags it simply isn't filtered out of anyone's roadmap yet.
  @IsArray()
  @IsEnum(LearningGoal, { each: true })
  @IsOptional()
  suitableGoals?: LearningGoal[];
}
