import { ExecutionContext, ServiceUnavailableException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PaymentRateLimitGuard } from './payment-rate-limit.guard';
import { RateLimitExceededException } from '../../auth/exceptions/rate-limit-exceeded.exception';

const buildContext = (userId: string | undefined): ExecutionContext =>
  ({
    getHandler: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ user: userId ? { userId } : undefined }),
    }),
  }) as unknown as ExecutionContext;

// Mirrors ChatRateLimitGuard.spec.ts verbatim — module-local rate-limit
// guards are this codebase's convention.
describe('PaymentRateLimitGuard', () => {
  it('allows a route with no policy metadata through untouched', async () => {
    const reflector = {
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as Reflector;
    const rateLimiter = { checkAndIncrement: jest.fn() };
    const guard = new PaymentRateLimitGuard(reflector, rateLimiter as never);

    await expect(guard.canActivate(buildContext('u1'))).resolves.toBe(true);
    expect(rateLimiter.checkAndIncrement).not.toHaveBeenCalled();
  });

  it('keys the Redis counter under its own payment:<kind>:<userId> namespace', async () => {
    const reflector = {
      get: jest
        .fn()
        .mockReturnValue({ kind: 'create', max: 5, windowSeconds: 300 }),
    } as unknown as Reflector;
    const rateLimiter = {
      checkAndIncrement: jest
        .fn()
        .mockResolvedValue({ allowed: true, count: 1 }),
    };
    const guard = new PaymentRateLimitGuard(reflector, rateLimiter as never);

    await guard.canActivate(buildContext('user-42'));

    expect(rateLimiter.checkAndIncrement).toHaveBeenCalledWith(
      'payment:create:user-42',
      5,
      300,
    );
  });

  it('throws RateLimitExceededException once the bucket is exhausted', async () => {
    const reflector = {
      get: jest
        .fn()
        .mockReturnValue({ kind: 'status', max: 60, windowSeconds: 60 }),
    } as unknown as Reflector;
    const rateLimiter = {
      checkAndIncrement: jest
        .fn()
        .mockResolvedValue({ allowed: false, count: 61 }),
    };
    const guard = new PaymentRateLimitGuard(reflector, rateLimiter as never);

    await expect(
      guard.canActivate(buildContext('user-42')),
    ).rejects.toBeInstanceOf(RateLimitExceededException);
  });

  it('fails closed when Redis itself is unavailable', async () => {
    const reflector = {
      get: jest
        .fn()
        .mockReturnValue({ kind: 'create', max: 5, windowSeconds: 300 }),
    } as unknown as Reflector;
    const rateLimiter = {
      checkAndIncrement: jest
        .fn()
        .mockRejectedValue(new ServiceUnavailableException()),
    };
    const guard = new PaymentRateLimitGuard(reflector, rateLimiter as never);

    await expect(
      guard.canActivate(buildContext('user-42')),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('lets an unauthenticated request through rather than crashing (defensive fallthrough — JwtAuthGuard always runs first)', async () => {
    const reflector = {
      get: jest
        .fn()
        .mockReturnValue({ kind: 'create', max: 5, windowSeconds: 300 }),
    } as unknown as Reflector;
    const rateLimiter = { checkAndIncrement: jest.fn() };
    const guard = new PaymentRateLimitGuard(reflector, rateLimiter as never);

    await expect(guard.canActivate(buildContext(undefined))).resolves.toBe(
      true,
    );
    expect(rateLimiter.checkAndIncrement).not.toHaveBeenCalled();
  });
});
