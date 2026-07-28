import { Type } from 'class-transformer';
import { QuizFeedbackMode } from '@prisma/client';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { UpsertQuestionDto } from './question.dto';

// PUT /lessons/:lessonId/quiz — whole-document upsert (task metadata + the
// complete question list in one transaction). Question ordering is the
// array's own order (orderIndex = position), so there is no separate
// reorder endpoint, and Duplicate Question in the admin editor is a pure
// client-side operation (copy the question object, drop its id, insert it
// below the original) rather than a new API.
export class UpsertQuizDto {
  // Null/absent falls back to QUIZ_DEFAULT_PASSING_SCORE_PERCENT — never
  // hardcoded, per the sprint spec.
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  passingScorePercent?: number;

  // Sprint 06B.5. Absent leaves an existing quiz's mode untouched and lets
  // a brand-new quiz take the schema default (IMMEDIATE) — an author who
  // never opens this control still gets the learning-oriented flow.
  @IsOptional()
  @IsEnum(QuizFeedbackMode)
  feedbackMode?: QuizFeedbackMode;

  @IsArray()
  @ArrayMinSize(0)
  @ValidateNested({ each: true })
  @Type(() => UpsertQuestionDto)
  questions: UpsertQuestionDto[];
}
