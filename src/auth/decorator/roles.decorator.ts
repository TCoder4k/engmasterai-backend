import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@prisma/client';

export const ROLES_KEY = 'roles';

/**
 * Decorator to specify which roles are allowed to access a route
 * @param roles - Array of UserRole values that are allowed
 * @example @Roles(UserRole.ADMIN)
 * @example @Roles(UserRole.USER, UserRole.ADMIN)
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
