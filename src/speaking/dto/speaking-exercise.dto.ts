import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { CefrLevel } from '@prisma/client';

// Speaking Partner — admin exercise authoring.
//
// `aiRole`/`conversationGoal` are writable here (an ADMIN-only surface) but
// are NEVER echoed back through the student read path — see
// SpeakingExerciseStudentView in speaking.types.ts, which has no field for
// either. `isPublished` is absent from both DTOs, same discipline as every
// other publish/unpublish-gated model in this codebase.

export class CreateSpeakingExerciseDto {
  @IsUUID()
  scenarioId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  titleVi!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  description!: string;

  /** Vietnamese translation of `description`, required like titleVi is — see the schema comment on SpeakingExercise.descriptionVi. */
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  descriptionVi!: string;

  @IsEnum(CefrLevel)
  level!: CefrLevel;

  /** Who the AI plays, e.g. "a barista at a busy coffee shop". AI-context only. */
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  aiRole!: string;

  /** The AI's authored first line — never Gemini-generated. */
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  openingLine!: string;

  /** Optional steering hint. AI-context only — never shown to a student. */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  conversationGoal?: string;

  /** Forward-looking, for a future Phase-3 "Bài luyện 1/5" UI. Unused this phase. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  targetTurns?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  orderIndex?: number;
}

export class UpdateSpeakingExerciseDto {
  @IsOptional()
  @IsUUID()
  scenarioId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  titleVi?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  descriptionVi?: string;

  @IsOptional()
  @IsEnum(CefrLevel)
  level?: CefrLevel;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  aiRole?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  openingLine?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  conversationGoal?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  targetTurns?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  orderIndex?: number;
}
