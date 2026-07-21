import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { RolesGuard } from './roles.guard';
import { ROLES_KEY } from '../decorators/roles.decorator';

const buildContext = (user?: { role: UserRole }): ExecutionContext => {
  const request = { user };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
};

// Relocated from src/auth/guard/roles.guard.ts to src/auth/guards/roles.guard.ts
// (Sprint 01A consolidation) — logic is unchanged; this is a regression check
// against the new location and its new decorator import path.
describe('RolesGuard (auth/guards/, unchanged logic)', () => {
  let reflector: jest.Mocked<Reflector>;
  let guard: RolesGuard;

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn(),
    } as unknown as jest.Mocked<Reflector>;
    guard = new RolesGuard(reflector);
  });

  it('allows access when the route declares no required roles', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    expect(guard.canActivate(buildContext({ role: UserRole.USER }))).toBe(true);
  });

  it('allows access when the authenticated user has one of the required roles', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.ADMIN]);
    expect(guard.canActivate(buildContext({ role: UserRole.ADMIN }))).toBe(
      true,
    );
  });

  it('denies access with 403 when the user lacks the required role', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.ADMIN]);
    expect(() =>
      guard.canActivate(buildContext({ role: UserRole.USER })),
    ).toThrow(ForbiddenException);
  });

  it('denies access with 403 when no user is present on the request', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.ADMIN]);
    expect(() => guard.canActivate(buildContext(undefined))).toThrow(
      ForbiddenException,
    );
  });

  it("reads metadata under the relocated decorator module's ROLES_KEY", () => {
    expect(ROLES_KEY).toBe('roles');
  });
});
