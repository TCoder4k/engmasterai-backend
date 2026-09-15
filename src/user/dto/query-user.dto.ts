import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

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

  // Admin student list only (AdminStudentOverviewService.listOverview) —
  // ignored by the plain GET /users list. FREE/PRO derived the same way as
  // the response's own isPro (Subscription.expiresAt vs now), never a
  // stored status.
  @IsIn(['FREE', 'PRO'])
  @IsOptional()
  plan?: 'FREE' | 'PRO';

  // Admin student list only, same scoping as `plan` above — filters on the
  // real User.isActive gate (see AuthService), never a display-only label.
  @IsIn(['ACTIVE', 'BLOCKED'])
  @IsOptional()
  status?: 'ACTIVE' | 'BLOCKED';
}
