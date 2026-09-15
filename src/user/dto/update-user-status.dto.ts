import { IsBoolean } from 'class-validator';

// PATCH /users/:id/status (ADMIN only). A real account-state gate, not a
// display label — see AuthService's isActive checks on login/refresh and the
// self-block guard in UserController.
export class UpdateUserStatusDto {
  @IsBoolean()
  isActive: boolean;
}
