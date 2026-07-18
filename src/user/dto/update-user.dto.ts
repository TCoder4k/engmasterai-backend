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

// Self-service update (PUT /users/me). Deliberately excludes role/level/
// totalPoints so a regular user cannot self-promote or self-grant XP by
// sending those fields — the app-wide ValidationPipe has no `whitelist`, so
// the guarantee comes from this DTO shape plus explicit field construction in
// UserService.updateProfile, not from the pipe stripping unknown props.
export class UpdateProfileDto {
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
}

// Admin update (PUT /users/:id, ADMIN only). May additionally set the
// privileged fields (role/level/totalPoints).
export class AdminUpdateUserDto {
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
