import { IsEnum, IsOptional, IsString } from 'class-validator';
import { CefrLevel } from '@prisma/client';

export class UpdateVocabDeckDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  thumbnail?: string;

  @IsEnum(CefrLevel)
  @IsOptional()
  cefrLevel?: CefrLevel;
}
