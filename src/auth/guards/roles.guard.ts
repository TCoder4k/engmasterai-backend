import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import type { Request } from 'express';
import { ROLES_KEY } from '../decorators/roles.decorator';

// Populated by JwtStrategy.validate() and attached to the request by Passport.
type RequestWithUser = Request & {
  user?: { userId: string; email: string; role: UserRole };
};

/**
 * Guard that checks if the authenticated user has the required role(s)
 * Must be used after JwtAuthGuard to ensure req.user is populated
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Get the roles metadata from the route handler or controller
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // If no roles are specified, allow access
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    // Get the user from the request (populated by JwtAuthGuard)
    const { user } = context.switchToHttp().getRequest<RequestWithUser>();

    if (!user || !user.role) {
      throw new ForbiddenException('Access denied: No role found');
    }

    // Check if user's role is in the required roles
    const hasRole = requiredRoles.includes(user.role);

    if (!hasRole) {
      throw new ForbiddenException(
        'Access denied: You do not have permission to access this resource',
      );
    }

    return true;
  }
}
