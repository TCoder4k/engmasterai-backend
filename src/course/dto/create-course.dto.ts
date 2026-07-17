import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { CourseType } from '@prisma/client';

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
}
