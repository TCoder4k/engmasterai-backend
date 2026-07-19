import { IsOptional, IsString } from 'class-validator';

export class UpdateVocabLibraryDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  thumbnail?: string;
}
