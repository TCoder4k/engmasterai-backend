import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Min, MaxLength, MinLength } from 'class-validator';
import { CefrLevel } from '@prisma/client';

// Speaking Partner — admin scenario authoring.
//
// `isPublished` is absent from both DTOs on purpose, exactly as it is absent
// from CreateListeningCategoryDto — publication state changes only through
// the dedicated publish/unpublish actions, so no general-purpose edit can
// flip a whole topic live by accident.

export class CreateSpeakingScenarioDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  /** Vietnamese label. Required — the student UI is bilingual, not English-first. */
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  nameVi!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  /** Vietnamese translation of `description` — see the schema comment on SpeakingScenario.descriptionVi. */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  descriptionVi?: string;

  @IsOptional()
  @IsEnum(CefrLevel)
  level?: CefrLevel;

  @IsOptional()
  @IsInt()
  @Min(0)
  orderIndex?: number;

  /** Marks the one open-topic "Free Talk" scenario — see the schema comment on SpeakingScenario.isFreeTalk. */
  @IsOptional()
  @IsBoolean()
  isFreeTalk?: boolean;
}

export class UpdateSpeakingScenarioDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  nameVi?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  descriptionVi?: string;

  @IsOptional()
  @IsEnum(CefrLevel)
  level?: CefrLevel;

  @IsOptional()
  @IsInt()
  @Min(0)
  orderIndex?: number;

  /** Marks the one open-topic "Free Talk" scenario — see the schema comment on SpeakingScenario.isFreeTalk. */
  @IsOptional()
  @IsBoolean()
  isFreeTalk?: boolean;
}
