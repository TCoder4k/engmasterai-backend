import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

// PUT /listening/manage/contents/:id/segments — whole-document upsert.
//
// THE SAME CONTRACT AS PUT /lessons/:lessonId/quiz, and for the same reasons:
//
//   - ids present in the database but absent from this payload are DELETED
//   - ids present are UPDATED IN PLACE, keeping the row
//   - entries with no id are CREATED
//   - `orderIndex` is the array's own position
//
// Which is why there is no reorder endpoint: reordering is sending the array
// in a new order.
//
// KEEPING THE ID MATTERS MORE HERE THAN IT DOES FOR QUESTIONS. From Phase 4A
// a segment carries a student's progress and (Phase 4B) their attempt history,
// both of which cascade from it. Rewriting the document as delete-all +
// create-all would silently destroy that history on every save of an unrelated
// typo — the service must never do it, and an e2e test pins that the id
// survives an edit.

export class UpsertListeningSegmentDto {
  /** Absent for a new sentence; present to update the existing row in place. */
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  text!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  ipa?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  translationVi?: string;

  /** Author's note. Admin-only — never present in a student response. */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  // Milliseconds. Capped at 24h so a mis-typed value cannot be stored as a
  // number no player could ever seek to.
  @IsInt()
  @Min(0)
  startTimeMs!: number;

  @IsInt()
  @Min(0)
  endTimeMs!: number;
}

export class UpsertListeningSegmentsDto {
  @IsArray()
  // A cap, not a target. The longest reference recording in the design notes
  // has 69 sentences; 500 leaves room without letting a single request carry
  // an unbounded write.
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => UpsertListeningSegmentDto)
  segments!: UpsertListeningSegmentDto[];
}
