import {
  CefrLevel,
  ListeningMediaProvider,
  ListeningMediaType,
  ListeningMode,
} from '@prisma/client';
import {
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

// Sprint 11 — admin content authoring.
//
// NO `isPublished` FIELD, on either DTO. Publication runs through
// PATCH .../publish so it can be gated by validateContentForPublish; a
// writable column here would be a way to publish content that fails every one
// of those rules.
//
// NO `segments` FIELD either. Segments are a whole-document PUT of their own
// (UpsertListeningSegmentsDto), the same split PUT /lessons/:id/quiz uses.
// Folding them in would mean every title edit re-sent, re-validated and
// re-wrote sixty sentences.
//
// `mediaUrl` accepts an empty string and that is deliberate: it is what lets a
// transcript be authored before the recording it belongs to has been cleared
// for use. Publishing rejects it (segment-validation.ts).

export class CreateListeningContentDto {
  @IsUUID()
  categoryId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsEnum(CefrLevel)
  level!: CefrLevel;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  thumbnailUrl?: string;

  /** Channel / publisher shown to the student. Required to publish YouTube media. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  sourceName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  sourceUrl?: string;

  @IsEnum(ListeningMediaType)
  mediaType!: ListeningMediaType;

  @IsEnum(ListeningMediaProvider)
  mediaProvider!: ListeningMediaProvider;

  @IsString()
  @MaxLength(500)
  mediaUrl!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  externalMediaId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  durationMs?: number;

  /**
   * Which practice modes this recording offers.
   *
   * May be empty on a draft — an author picks the media and transcript first
   * and decides about shadowing once the sentence lengths are known. Publishing
   * requires at least one.
   */
  @IsArray()
  @IsEnum(ListeningMode, { each: true })
  @ArrayUnique()
  supportedModes!: ListeningMode[];

  @IsOptional()
  @IsInt()
  @Min(0)
  orderIndex?: number;
}

export class UpdateListeningContentDto {
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsEnum(CefrLevel)
  level?: CefrLevel;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  thumbnailUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  sourceName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  sourceUrl?: string;

  @IsOptional()
  @IsEnum(ListeningMediaType)
  mediaType?: ListeningMediaType;

  @IsOptional()
  @IsEnum(ListeningMediaProvider)
  mediaProvider?: ListeningMediaProvider;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  mediaUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  externalMediaId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  durationMs?: number;

  @IsOptional()
  @IsArray()
  @IsEnum(ListeningMode, { each: true })
  @ArrayUnique()
  supportedModes?: ListeningMode[];

  @IsOptional()
  @IsInt()
  @Min(0)
  orderIndex?: number;
}
