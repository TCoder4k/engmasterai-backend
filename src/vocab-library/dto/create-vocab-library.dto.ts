import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateVocabLibraryDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsString()
  @IsOptional()
  thumbnail?: string;
}
