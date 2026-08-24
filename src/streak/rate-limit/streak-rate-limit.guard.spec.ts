import { ExecutionContext, ServiceUnavailableException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { StreakRateLimitGuard } from './streak-rate-limit.guard';
import { RateLimitExceededException } from '../../auth/exceptions/rate-limit-exceeded.exception';

const buildContext = (userId: string | undefined): ExecutionContext =>
  ({
    getHandler: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ user: userId ? { userId } : undefined }),
    }),
  }) as unknown as ExecutionContext;

// Mirrors CommunityChatRateLimitGuard.spec.ts verbatim.
describe('StreakRateLimitGuard', () => {
  it('allows a route with no policy metadata through untouched', async () => {
    const reflector = { get: jest.fn().mockReturnValue(undefined) } as unknown as Reflector;
    const rateLimiter = { checkAndIncrement: jest.fn() };
    const guard = new StreakRateLimitGuard(reflector, rateLimiter as never);

    await expect(guard.canActivate(buildContext('u1'))).resolves.toBe(true);
    expect(rateLimiter.checkAndIncrement).not.toHaveBeenCalled();
  });

  it('keys the Redis counter under its own streak namespace, never community/chat/notification', async () => {
    const reflector = {
      get: jest.fn().mockReturnValue({ kind: 'invite', max: 10, windowSeconds: 3600 }),
    } as unknown as Reflector;
    const rateLimiter = {
      checkAndIncrement: jest.fn().mockResolvedValue({ allowed: true, count: 1 }),
    };
    const guard = new StreakRateLimitGuard(reflector, rateLimiter as never);

    await guard.canActivate(buildContext('user-42'));

    expect(rateLimiter.checkAndIncrement).toHaveBeenCalledWith('streak:invite:user-42', 10, 3600);
  });

  it('throws RateLimitExceededException once the bucket is exhausted', async () => {
    const reflector = {
      get: jest.fn().mockReturnValue({ kind: 'invite', max: 10, windowSeconds: 3600 }),
    } as unknown as Reflector;
    const rateLimiter = {
      checkAndIncrement: jest.fn().mockResolvedValue({ allowed: false, count: 11 }),
    };
    const guard = new StreakRateLimitGuard(reflector, rateLimiter as never);

    await expect(guard.canActivate(buildContext('user-42'))).rejects.toBeInstanceOf(RateLimitExceededException);
  });

  it('fails closed when Redis itself is unavailable', async () => {
    const reflector = {
      get: jest.fn().mockReturnValue({ kind: 'read', max: 60, windowSeconds: 60 }),
    } as unknown as Reflector;
    const rateLimiter = {
      checkAndIncrement: jest.fn().mockRejectedValue(new ServiceUnavailableException()),
    };
    const guard = new StreakRateLimitGuard(reflector, rateLimiter as never);

    await expect(guard.canActivate(buildContext('user-42'))).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('lets an unauthenticated request through rather than crashing (JwtAuthGuard already ran first)', async () => {
    const reflector = {
      get: jest.fn().mockReturnValue({ kind: 'invite', max: 10, windowSeconds: 3600 }),
    } as unknown as Reflector;
    const rateLimiter = { checkAndIncrement: jest.fn() };
    const guard = new StreakRateLimitGuard(reflector, rateLimiter as never);

    await expect(guard.canActivate(buildContext(undefined))).resolves.toBe(true);
    expect(rateLimiter.checkAndIncrement).not.toHaveBeenCalled();
  });
});
