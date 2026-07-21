/* eslint-disable @typescript-eslint/unbound-method -- expect(mock.fn).toHaveBeenCalledWith(...) on jest.fn() mock references throughout */
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { AuthRateLimitGuard } from './auth-rate-limit.guard';
import { RateLimiterService } from '../rate-limit/rate-limiter.service';
import { RefreshTokenService } from '../refresh-token.service';
import { AuthEventLogger } from '../logging/auth-event-logger.service';
import { RateLimitExceededException } from '../exceptions/rate-limit-exceeded.exception';
import { RateLimitPolicy } from '../decorators/rate-limits.decorator';

const CONFIG_VALUES: Record<string, number> = {
  MAX_A: 5,
  WINDOW_A: 60,
  MAX_B: 20,
  WINDOW_B: 60,
};

function buildContext(req: Partial<Request>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => req as Request,
    }),
    getHandler: () => (() => undefined) as unknown as () => void,
  } as unknown as ExecutionContext;
}

describe('AuthRateLimitGuard', () => {
  let reflector: jest.Mocked<Reflector>;
  let rateLimiter: jest.Mocked<RateLimiterService>;
  let config: jest.Mocked<ConfigService>;
  let refreshTokenService: jest.Mocked<RefreshTokenService>;
  let authEventLogger: jest.Mocked<AuthEventLogger>;
  let guard: AuthRateLimitGuard;

  beforeEach(() => {
    reflector = { get: jest.fn() } as unknown as jest.Mocked<Reflector>;
    rateLimiter = {
      checkAndIncrement: jest
        .fn()
        .mockResolvedValue({ allowed: true, count: 1 }),
    } as unknown as jest.Mocked<RateLimiterService>;
    config = {
      get: jest.fn((key: string) => CONFIG_VALUES[key]),
    } as unknown as jest.Mocked<ConfigService>;
    refreshTokenService = {
      parseCookieValue: jest.fn().mockReturnValue(null),
    } as unknown as jest.Mocked<RefreshTokenService>;
    authEventLogger = {
      log: jest.fn(),
    } as unknown as jest.Mocked<AuthEventLogger>;

    guard = new AuthRateLimitGuard(
      reflector,
      rateLimiter,
      config,
      refreshTokenService,
      authEventLogger,
    );
  });

  it('allows the request through when no @RateLimits metadata is present (e.g. logout)', async () => {
    reflector.get.mockReturnValue(undefined);

    const result = await guard.canActivate(
      buildContext({ ip: '203.0.113.1', body: {}, cookies: {} }),
    );

    expect(result).toBe(true);
    expect(rateLimiter.checkAndIncrement).not.toHaveBeenCalled();
  });

  it('evaluates every listed policy, not just the first', async () => {
    const policies: RateLimitPolicy[] = [
      {
        kind: 'login-combo',
        maxConfigKey: 'MAX_A',
        windowConfigKey: 'WINDOW_A',
      },
      { kind: 'login-ip', maxConfigKey: 'MAX_B', windowConfigKey: 'WINDOW_B' },
    ];
    reflector.get.mockReturnValue(policies);

    await guard.canActivate(
      buildContext({
        ip: '203.0.113.1',
        body: { email: 'user@example.test' },
        cookies: {},
      }),
    );

    expect(rateLimiter.checkAndIncrement).toHaveBeenCalledTimes(2);
  });

  it('throws RateLimitExceededException the moment any bucket is over its max', async () => {
    const policies: RateLimitPolicy[] = [
      {
        kind: 'login-combo',
        maxConfigKey: 'MAX_A',
        windowConfigKey: 'WINDOW_A',
      },
      { kind: 'login-ip', maxConfigKey: 'MAX_B', windowConfigKey: 'WINDOW_B' },
    ];
    reflector.get.mockReturnValue(policies);
    rateLimiter.checkAndIncrement
      .mockResolvedValueOnce({ allowed: true, count: 1 })
      .mockResolvedValueOnce({ allowed: false, count: 21 });

    await expect(
      guard.canActivate(
        buildContext({
          ip: '203.0.113.1',
          body: { email: 'user@example.test' },
          cookies: {},
        }),
      ),
    ).rejects.toBeInstanceOf(RateLimitExceededException);

    expect(authEventLogger.log).toHaveBeenCalledWith(
      'auth.rate_limit.exceeded',
      expect.objectContaining({ failureCategory: 'login-ip' }),
    );
  });

  it('skips a combo bucket (no key derivable) when the body has no email, but still evaluates the IP bucket', async () => {
    const policies: RateLimitPolicy[] = [
      {
        kind: 'login-combo',
        maxConfigKey: 'MAX_A',
        windowConfigKey: 'WINDOW_A',
      },
      { kind: 'login-ip', maxConfigKey: 'MAX_B', windowConfigKey: 'WINDOW_B' },
    ];
    reflector.get.mockReturnValue(policies);

    await guard.canActivate(
      buildContext({ ip: '203.0.113.1', body: {}, cookies: {} }),
    );

    // Only the IP-only bucket has a derivable key when there's no email.
    expect(rateLimiter.checkAndIncrement).toHaveBeenCalledTimes(1);
  });

  it('refresh-ip bucket applies even when a well-formed family id is present (not only on a malformed/missing cookie)', async () => {
    const policies: RateLimitPolicy[] = [
      {
        kind: 'refresh-family',
        maxConfigKey: 'MAX_A',
        windowConfigKey: 'WINDOW_A',
      },
      {
        kind: 'refresh-ip',
        maxConfigKey: 'MAX_B',
        windowConfigKey: 'WINDOW_B',
      },
    ];
    reflector.get.mockReturnValue(policies);
    refreshTokenService.parseCookieValue.mockReturnValue({
      familyId: 'real-family-id',
      secret: 'secret',
    });

    await guard.canActivate(
      buildContext({
        ip: '203.0.113.1',
        body: {},
        cookies: { emai_rt: 'real-family-id.secret' },
      }),
    );

    // Both the family bucket AND the IP backstop are checked — a fabricated,
    // valid-looking family id on every request still can't dodge the IP
    // bucket, since the IP bucket never depends on the family id at all.
    expect(rateLimiter.checkAndIncrement).toHaveBeenCalledTimes(2);
  });

  it('refresh-family bucket is skipped (no key derivable) when the cookie is malformed/missing, IP bucket still applies', async () => {
    const policies: RateLimitPolicy[] = [
      {
        kind: 'refresh-family',
        maxConfigKey: 'MAX_A',
        windowConfigKey: 'WINDOW_A',
      },
      {
        kind: 'refresh-ip',
        maxConfigKey: 'MAX_B',
        windowConfigKey: 'WINDOW_B',
      },
    ];
    reflector.get.mockReturnValue(policies);
    refreshTokenService.parseCookieValue.mockReturnValue(null);

    await guard.canActivate(
      buildContext({ ip: '203.0.113.1', body: {}, cookies: {} }),
    );

    expect(rateLimiter.checkAndIncrement).toHaveBeenCalledTimes(1);
  });
});
