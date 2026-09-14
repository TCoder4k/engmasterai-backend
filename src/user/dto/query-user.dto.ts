import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

// Query params for GET /users. Mirrors QueryCourseDto: the @Type(() => Number)
// coercion only takes effect under a transform-enabled ValidationPipe, which
// the controller scopes to this @Query() param (the global pipe has no
// `transform`), so "5" arrives as a number instead of reaching Prisma's
// `take`/`skip` as a string and throwing.
export class QueryUserDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  limit?: number;

  // Matches against name or email, case-insensitively — see
  // UserService.findAll. No @Length cap: an overlong value just matches
  // nothing, same as any other search box.
  @IsString()
  @IsOptional()
  search?: string;
}
