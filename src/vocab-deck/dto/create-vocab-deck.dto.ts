import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { CefrLevel } from '@prisma/client';

export class CreateVocabDeckDto {
  @IsString()
  @IsNotEmpty()
  name: string;

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
