import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { MAX_SPEAKING_REPLY_CHARS } from '../speaking.types';

export class TranslateSpeakingTextDto {
  /**
   * Trimmed BEFORE validation, so whitespace-only input fails `@IsNotEmpty`
   * instead of slipping through as a "non-empty" string of spaces — and the
   * controller receives the trimmed value too (the body-scoped
   * `ValidationPipe({ transform: true })` this route uses is what makes
   * that true; the global pipe in main.ts does not enable `transform`).
   */
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_SPEAKING_REPLY_CHARS)
  text!: string;
}
