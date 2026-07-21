import {
  ExecutionContext,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { TokenBlacklistService } from '../token-blacklist.service';

const buildContext = (authorizationHeader?: string): ExecutionContext => {
  const request = {
    headers: authorizationHeader ? { authorization: authorizationHeader } : {},
  };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
};

describe('JwtAuthGuard (consolidated — the single source of truth post-Sprint-01A)', () => {
  let blacklist: jest.Mocked<TokenBlacklistService>;
  let guard: JwtAuthGuard;
  let superCanActivateSpy: jest.SpyInstance;

  beforeEach(() => {
    blacklist = {
      isBlacklisted: jest.fn(),
      addToBlacklist: jest.fn(),
    } as unknown as jest.Mocked<TokenBlacklistService>;
    guard = new JwtAuthGuard(blacklist);

    // `super.canActivate` is Passport's AuthGuard('jwt') implementation —
    // spied on the actual parent prototype JwtAuthGuard was declared
    // against, so tests can isolate the blacklist-check logic this guard
    // adds without needing a real Passport strategy/JWT to verify.
    const parentPrototype = Object.getPrototypeOf(JwtAuthGuard.prototype) as {
      canActivate: (context: ExecutionContext) => Promise<boolean>;
    };
    superCanActivateSpy = jest
      .spyOn(parentPrototype, 'canActivate')
      .mockResolvedValue(true);
  });

  afterEach(() => {
    superCanActivateSpy.mockRestore();
  });

  it('a valid, non-blacklisted token passes through to Passport', async () => {
    blacklist.isBlacklisted.mockResolvedValue(false);

    await expect(
      guard.canActivate(buildContext('Bearer valid.jwt.token')),
    ).resolves.toBe(true);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- jest.fn() mock reference, not a real unbound method
    expect(blacklist.isBlacklisted).toHaveBeenCalledWith('valid.jwt.token');
    expect(superCanActivateSpy).toHaveBeenCalled();
  });

  it('a blacklisted token is rejected with 401 without ever reaching Passport', async () => {
    blacklist.isBlacklisted.mockResolvedValue(true);

    await expect(
      guard.canActivate(buildContext('Bearer revoked.jwt.token')),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(superCanActivateSpy).not.toHaveBeenCalled();
  });

  it('a missing token skips the blacklist check and is rejected by Passport (regression: unchanged behavior)', async () => {
    superCanActivateSpy.mockRejectedValue(new UnauthorizedException());

    await expect(
      guard.canActivate(buildContext(undefined)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- jest.fn() mock reference, not a real unbound method
    expect(blacklist.isBlacklisted).not.toHaveBeenCalled();
  });

  it('an expired-but-not-blacklisted token is still rejected by Passport with 401 (regression: unchanged behavior)', async () => {
    blacklist.isBlacklisted.mockResolvedValue(false);
    superCanActivateSpy.mockRejectedValue(
      new UnauthorizedException('jwt expired'),
    );

    await expect(
      guard.canActivate(buildContext('Bearer expired.jwt.token')),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('a Redis failure during the blacklist check surfaces as 503 — never a silent pass, never a 401', async () => {
    blacklist.isBlacklisted.mockRejectedValue(
      new ServiceUnavailableException(),
    );

    await expect(
      guard.canActivate(buildContext('Bearer some.jwt.token')),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(superCanActivateSpy).not.toHaveBeenCalled();
  });
});
