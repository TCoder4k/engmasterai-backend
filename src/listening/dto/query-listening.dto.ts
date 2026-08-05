import { Type } from 'class-transformer';
import { CefrLevel, ListeningMode } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

// Sprint 11 — list queries.
//
// `page` / `limit`, matching QueryCourseDto exactly. An earlier draft of the
// plan used `page`/`pageSize`, which would have made this the only paginated
// endpoint in the codebase with its own vocabulary.
//
// The app-wide ValidationPipe (main.ts) does not enable `transform`, so "5"
// from a query string would never reach the @Type(() => Number) coercion.
// The controllers scope their own transform-enabled pipe to these DTOs — the
// same local fix CourseController and CourseProgressController already use,
// rather than changing global validation for every module.

export class QueryListeningCatalogDto {
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
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsEnum(CefrLevel)
  level?: CefrLevel;

  /** Restrict to content offering this practice mode. */
  @IsOptional()
  @IsEnum(ListeningMode)
  mode?: ListeningMode;

  /** Free-text search over the title. Case-insensitive, substring. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class QueryListeningManageDto {
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
  @IsUUID()
  categoryId?: string;
}
