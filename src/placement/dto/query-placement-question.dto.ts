import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';
import { CourseType, QuestionDifficulty } from '@prisma/client';

// GET /placement/questions/manage — mirrors QueryListeningManageDto's shape
// (src/listening/dto/query-listening.dto.ts): pagination plus optional
// filters, all @IsOptional so an empty query is a valid "everything" query.
export class QueryPlacementQuestionDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  limit?: number;

  @IsOptional()
  @IsEnum(CourseType)
  section?: CourseType;

  @IsOptional()
  @IsEnum(QuestionDifficulty)
  difficulty?: QuestionDifficulty;
}
