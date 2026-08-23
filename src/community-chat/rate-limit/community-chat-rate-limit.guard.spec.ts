import { ExecutionContext, ServiceUnavailableException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CommunityChatRateLimitGuard } from './community-chat-rate-limit.guard';
import { RateLimitExceededException } from '../../auth/exceptions/rate-limit-exceeded.exception';

const buildContext = (userId: string | undefined): ExecutionContext =>
  ({
    getHandler: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ user: userId ? { userId } : undefined }),
    }),
  }) as unknown as ExecutionContext;

describe('CommunityChatRateLimitGuard', () => {
  it('allows a route with no policy metadata through untouched', async () => {
    const reflector = { get: jest.fn().mockReturnValue(undefined) } as unknown as Reflector;
    const rateLimiter = { checkAndIncrement: jest.fn() };
    const guard = new CommunityChatRateLimitGuard(reflector, rateLimiter as never);

    await expect(guard.canActivate(buildContext('u1'))).resolves.toBe(true);
    expect(rateLimiter.checkAndIncrement).not.toHaveBeenCalled();
  });

  it('keys the Redis counter under its own community namespace, never chat/speaking/dictionary', async () => {
    const reflector = {
      get: jest.fn().mockReturnValue({ kind: 'send', max: 20, windowSeconds: 60 }),
    } as unknown as Reflector;
    const rateLimiter = {
      checkAndIncrement: jest.fn().mockResolvedValue({ allowed: true, count: 1 }),
    };
    const guard = new CommunityChatRateLimitGuard(reflector, rateLimiter as never);

    await guard.canActivate(buildContext('user-42'));

    expect(rateLimiter.checkAndIncrement).toHaveBeenCalledWith('community:send:user-42', 20, 60);
  });

  it('throws RateLimitExceededException once the bucket is exhausted', async () => {
    const reflector = {
      get: jest.fn().mockReturnValue({ kind: 'send', max: 20, windowSeconds: 60 }),
    } as unknown as Reflector;
    const rateLimiter = {
      checkAndIncrement: jest.fn().mockResolvedValue({ allowed: false, count: 21 }),
    };
    const guard = new CommunityChatRateLimitGuard(reflector, rateLimiter as never);

    await expect(guard.canActivate(buildContext('user-42'))).rejects.toBeInstanceOf(
      RateLimitExceededException,
    );
  });

  it('fails closed when Redis itself is unavailable', async () => {
    const reflector = {
      get: jest.fn().mockReturnValue({ kind: 'read', max: 60, windowSeconds: 60 }),
    } as unknown as Reflector;
    const rateLimiter = {
      checkAndIncrement: jest.fn().mockRejectedValue(new ServiceUnavailableException()),
    };
    const guard = new CommunityChatRateLimitGuard(reflector, rateLimiter as never);

    await expect(guard.canActivate(buildContext('user-42'))).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  // Defensive fallthrough only — JwtAuthGuard always runs first on every
  // route this guard is attached to and would already have rejected an
  // unauthenticated request.
  it('lets an unauthenticated request through rather than crashing', async () => {
    const reflector = {
      get: jest.fn().mockReturnValue({ kind: 'send', max: 20, windowSeconds: 60 }),
    } as unknown as Reflector;
    const rateLimiter = { checkAndIncrement: jest.fn() };
    const guard = new CommunityChatRateLimitGuard(reflector, rateLimiter as never);

    await expect(guard.canActivate(buildContext(undefined))).resolves.toBe(true);
    expect(rateLimiter.checkAndIncrement).not.toHaveBeenCalled();
  });
});
