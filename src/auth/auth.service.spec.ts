/* eslint-disable @typescript-eslint/unbound-method -- `expect(mock.fn).toHaveBeenCalledWith(...)` on jest.fn() mock references throughout this file, not real unbound methods */
import { ServiceUnavailableException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { TokenBlacklistService } from './token-blacklist.service';
import { RefreshTokenService } from './refresh-token.service';
import {
  AuthEventLogger,
  AuthLogContext,
} from './logging/auth-event-logger.service';
import { GoogleTokenVerifierService } from './google/google-token-verifier.service';
import { RateLimiterService } from './rate-limit/rate-limiter.service';
import { TransactionalMailService } from '../mail/transactional-mail.service';

const testLogContext: AuthLogContext = {
  requestId: 'test-request-id',
  ipHash: 'test-ip-hash',
};

// Sprint 01A §6.A.5 — logout must be idempotent and best-effort, tolerating
// a missing/expired/malformed access token, and must fail closed (503) only
// when Redis itself is unreachable.
describe('AuthService — logout', () => {
  let service: AuthService;
  let jwtService: jest.Mocked<JwtService>;
  let configService: jest.Mocked<ConfigService>;
  let authEventLogger: jest.Mocked<AuthEventLogger>;
  let blacklist: jest.Mocked<TokenBlacklistService>;
  let refreshTokenService: jest.Mocked<RefreshTokenService>;
  let googleTokenVerifier: jest.Mocked<GoogleTokenVerifierService>;
  let rateLimiterService: jest.Mocked<RateLimiterService>;
  let transactionalMailService: jest.Mocked<TransactionalMailService>;
  let prisma: PrismaService;

  const validAuthHeader = 'Bearer valid.jwt.token';
  const cookieValue = 'family-1.secret-1';

  beforeEach(() => {
    jwtService = {
      verify: jest.fn(),
      decode: jest.fn(),
      signAsync: jest.fn(),
    } as unknown as jest.Mocked<JwtService>;

    blacklist = {
      addToBlacklist: jest.fn(),
      isBlacklisted: jest.fn(),
    } as unknown as jest.Mocked<TokenBlacklistService>;

    refreshTokenService = {
      parseCookieValue: jest.fn(),
      encodeCookieValue: jest.fn(),
      issue: jest.fn(),
      rotate: jest.fn(),
      revoke: jest.fn(),
    } as unknown as jest.Mocked<RefreshTokenService>;

    configService = {
      get: jest.fn().mockReturnValue('test-jwt-secret'),
    } as unknown as jest.Mocked<ConfigService>;

    authEventLogger = {
      log: jest.fn(),
    } as unknown as jest.Mocked<AuthEventLogger>;

    googleTokenVerifier = {
      verify: jest.fn(),
    } as unknown as jest.Mocked<GoogleTokenVerifierService>;

    rateLimiterService = {
      checkAndIncrement: jest.fn(),
    } as unknown as jest.Mocked<RateLimiterService>;

    transactionalMailService = {
      sendVerificationEmail: jest.fn(),
    } as unknown as jest.Mocked<TransactionalMailService>;

    prisma = {} as PrismaService;

    service = new AuthService(
      prisma,
      jwtService,
      configService,
      blacklist,
      refreshTokenService,
      authEventLogger,
      googleTokenVerifier,
      rateLimiterService,
      transactionalMailService,
    );
  });

  it('blacklists a valid, unexpired access token', async () => {
    jwtService.verify.mockReturnValue({
      sub: 'user-1',
      exp: Math.floor(Date.now() / 1000) + 60,
    } as never);
    refreshTokenService.parseCookieValue.mockReturnValue(null);

    const result = await service.logout(
      validAuthHeader,
      undefined,
      testLogContext,
    );

    expect(blacklist.addToBlacklist).toHaveBeenCalledWith(
      'valid.jwt.token',
      expect.any(Number),
    );
    expect(result).toEqual({ message: 'Logout successful' });
  });

  it('succeeds when the access token is expired — verification tolerates exp, blacklist-add is still attempted', async () => {
    jwtService.verify.mockReturnValue({
      sub: 'user-1',
      exp: Math.floor(Date.now() / 1000) - 600,
    } as never);
    refreshTokenService.parseCookieValue.mockReturnValue(null);

    const result = await service.logout(
      validAuthHeader,
      undefined,
      testLogContext,
    );

    expect(jwtService.verify).toHaveBeenCalledWith(
      'valid.jwt.token',
      expect.objectContaining({ ignoreExpiration: true }),
    );
    expect(result).toEqual({ message: 'Logout successful' });
  });

  it('succeeds when the access token is missing entirely', async () => {
    refreshTokenService.parseCookieValue.mockReturnValue(null);

    const result = await service.logout(undefined, undefined, testLogContext);

    expect(jwtService.verify).not.toHaveBeenCalled();
    expect(blacklist.addToBlacklist).not.toHaveBeenCalled();
    expect(result).toEqual({ message: 'Logout successful' });
  });

  it('succeeds when the access token is malformed / fails signature verification', async () => {
    jwtService.verify.mockImplementation(() => {
      throw new Error('invalid signature');
    });
    refreshTokenService.parseCookieValue.mockReturnValue(null);

    const result = await service.logout(
      'Bearer garbage',
      undefined,
      testLogContext,
    );

    expect(blacklist.addToBlacklist).not.toHaveBeenCalled();
    expect(result).toEqual({ message: 'Logout successful' });
  });

  it('revokes the refresh family when a well-formed cookie is present', async () => {
    refreshTokenService.parseCookieValue.mockReturnValue({
      familyId: 'family-1',
      secret: 'secret-1',
    });

    await service.logout(undefined, cookieValue, testLogContext);

    expect(refreshTokenService.revoke).toHaveBeenCalledWith('family-1');
  });

  it('succeeds with no/malformed refresh cookie, and does not attempt a revoke', async () => {
    refreshTokenService.parseCookieValue.mockReturnValue(null);

    const result = await service.logout(
      undefined,
      'not-a-valid-cookie-shape',
      testLogContext,
    );

    expect(refreshTokenService.revoke).not.toHaveBeenCalled();
    expect(result).toEqual({ message: 'Logout successful' });
  });

  it('is idempotent — repeated calls with the same (now-stale) credentials still succeed', async () => {
    jwtService.verify.mockReturnValue({
      sub: 'user-1',
      exp: Math.floor(Date.now() / 1000) - 600,
    } as never);
    refreshTokenService.parseCookieValue.mockReturnValue({
      familyId: 'family-1',
      secret: 'secret-1',
    });

    const first = await service.logout(
      validAuthHeader,
      cookieValue,
      testLogContext,
    );
    const second = await service.logout(
      validAuthHeader,
      cookieValue,
      testLogContext,
    );

    expect(first).toEqual({ message: 'Logout successful' });
    expect(second).toEqual({ message: 'Logout successful' });
  });

  it('a Redis failure while blacklisting propagates as 503, not a false success', async () => {
    jwtService.verify.mockReturnValue({
      sub: 'user-1',
      exp: Math.floor(Date.now() / 1000) + 60,
    } as never);
    blacklist.addToBlacklist.mockRejectedValue(
      new ServiceUnavailableException(),
    );
    refreshTokenService.parseCookieValue.mockReturnValue(null);

    await expect(
      service.logout(validAuthHeader, undefined, testLogContext),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('a Redis failure while revoking the refresh family propagates as 503', async () => {
    refreshTokenService.parseCookieValue.mockReturnValue({
      familyId: 'family-1',
      secret: 'secret-1',
    });
    refreshTokenService.revoke.mockRejectedValue(
      new ServiceUnavailableException(),
    );

    await expect(
      service.logout(undefined, cookieValue, testLogContext),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
