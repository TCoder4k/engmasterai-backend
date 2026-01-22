import {
  IsEmail,
  IsOptional,
  IsString,
  MinLength,
  IsEnum,
  IsInt,
  Min,
} from 'class-validator';
import { UserRole } from '@prisma/client';

export class UpdateUserDto {
  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  @MinLength(6)
  password?: string;

  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  avatarUrl?: string;

  @IsEnum(UserRole)
  @IsOptional()
  role?: UserRole;

  @IsInt()
  @Min(0)
  @IsOptional()
  totalPoints?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  level?: number;
}
