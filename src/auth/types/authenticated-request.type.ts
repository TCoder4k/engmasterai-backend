import type { Request } from 'express';
import type { UserRole } from '@prisma/client';

// Populated by JwtStrategy.validate() and attached to the request by Passport.
// Every controller using this type sits behind JwtAuthGuard, which rejects
// with 401 before a handler ever runs — so `user` is guaranteed present here,
// unlike RolesGuard's own defensive, optional copy (guards/roles.guard.ts),
// which must tolerate running in contexts that haven't been guarded yet.
export interface AuthenticatedRequest extends Request {
  user: {
    userId: string;
    email: string;
    role: UserRole;
  };
}
