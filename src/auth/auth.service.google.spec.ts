/* eslint-disable @typescript-eslint/unbound-method -- jest.fn() mock references, not real unbound methods */
import {
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import * as argon from 'argon2';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthProvider, Prisma, UserRole } from '@prisma/client';
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
import { GoogleTokenInvalidError } from './google/google-token-invalid.error';
import { AccountLinkRequiredException } from './exceptions/account-link-required.exception';
import { RateLimitExceededException } from './exceptions/rate-limit-exceeded.exception';
import { TransactionalMailService } from '../mail/transactional-mail.service';

const testLogContext: AuthLogContext = {
  requestId: 'test-request-id',
  ipHash: 'test-ip-hash',
};

const verifiedIdentity = {
  sub: 'google-subject-1',
  email: 'user@example.com',
  name: 'Test User',
  picture: 'https://example.com/pic.jpg',
};

const uniqueConstraintError = (): Prisma.PrismaClientKnownRequestError =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });

// jest.Mock's own `.mock.calls` is typed `any[]`; this centralizes the one
// cast needed to read a mock's first call's first argument as a known shape
// without a chain of unsafe `any` member accesses at every call site.
const firstCallArg = <T>(mockFn: jest.Mock): T =>
  (mockFn.mock.calls as unknown[][])[0][0] as T;

describe('AuthService — google() / linkGoogle()', () => {
  let service: AuthService;
  let jwtService: jest.Mocked<JwtService>;
  let configService: jest.Mocked<ConfigService>;
  let authEventLogger: jest.Mocked<AuthEventLogger>;
  let refreshTokenService: jest.Mocked<RefreshTokenService>;
  let googleTokenVerifier: jest.Mocked<GoogleTokenVerifierService>;
  let rateLimiterService: jest.Mocked<RateLimiterService>;
  let transactionalMailService: jest.Mocked<TransactionalMailService>;
  let prisma: {
    user: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    authIdentity: {
      findUnique: jest.Mock;
      create: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  const createdUser = {
    id: 'user-1',
    name: verifiedIdentity.name,
    email: verifiedIdentity.email,
    role: UserRole.USER,
    emailVerifiedAt: new Date(),
  };

  beforeEach(() => {
    jwtService = {
      signAsync: jest.fn().mockResolvedValue('signed.jwt.token'),
    } as unknown as jest.Mocked<JwtService>;

    configService = {
      get: jest.fn((key: string) => {
        const values: Record<string, unknown> = {
          JWT_SECRET: 'test-jwt-secret',
          AUTH_GOOGLE_LINK_RATE_LIMIT_MAX: 5,
          AUTH_GOOGLE_LINK_RATE_LIMIT_WINDOW_SECONDS: 60,
        };
        return values[key];
      }),
    } as unknown as jest.Mocked<ConfigService>;

    authEventLogger = {
      log: jest.fn(),
    } as unknown as jest.Mocked<AuthEventLogger>;

    refreshTokenService = {
      issue: jest
        .fn()
        .mockResolvedValue({ familyId: 'family-1', secret: 'secret-1' }),
      encodeCookieValue: jest.fn().mockReturnValue('family-1.secret-1'),
    } as unknown as jest.Mocked<RefreshTokenService>;

    googleTokenVerifier = {
      verify: jest.fn().mockResolvedValue(verifiedIdentity),
    } as unknown as jest.Mocked<GoogleTokenVerifierService>;

    rateLimiterService = {
      checkAndIncrement: jest
        .fn()
        .mockResolvedValue({ allowed: true, count: 1 }),
    } as unknown as jest.Mocked<RateLimiterService>;

    transactionalMailService = {
      sendVerificationEmail: jest.fn(),
    } as unknown as jest.Mocked<TransactionalMailService>;

    prisma = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      authIdentity: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      $transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({
          user: { create: prisma.user.create },
          authIdentity: { create: prisma.authIdentity.create },
        }),
      ),
    };

    service = new AuthService(
      prisma as unknown as PrismaService,
      jwtService,
      configService,
      {} as unknown as TokenBlacklistService,
      refreshTokenService,
      authEventLogger,
      googleTokenVerifier,
      rateLimiterService,
      transactionalMailService,
    );
  });

  describe('google()', () => {
    it('creates a new User + AuthIdentity for a brand-new Google identity, with password null and emailVerifiedAt set', async () => {
      prisma.authIdentity.findUnique.mockResolvedValue(null); // no existing identity
      prisma.user.findUnique.mockResolvedValue(null); // no existing user by email
      prisma.user.create.mockResolvedValue(createdUser);
      prisma.authIdentity.create.mockResolvedValue({});

      const result = await service.google(
        { credential: 'valid.jwt.token' },
        null,
        testLogContext,
      );

      const createUserCall = firstCallArg<{
        data: {
          email: string;
          password: string | null;
          role: UserRole;
          avatarUrl: string | null;
          emailVerifiedAt: Date;
        };
      }>(prisma.user.create);
      expect(createUserCall.data.email).toBe(verifiedIdentity.email);
      expect(createUserCall.data.password).toBeNull();
      expect(createUserCall.data.role).toBe(UserRole.USER);
      expect(createUserCall.data.avatarUrl).toBe(verifiedIdentity.picture);
      expect(createUserCall.data.emailVerifiedAt).toBeInstanceOf(Date);

      const createIdentityCall = firstCallArg<{
        data: {
          userId: string;
          provider: AuthProvider;
          providerSubject: string;
          providerEmail: string;
        };
      }>(prisma.authIdentity.create);
      expect(createIdentityCall.data.userId).toBe(createdUser.id);
      expect(createIdentityCall.data.provider).toBe(AuthProvider.GOOGLE);
      expect(createIdentityCall.data.providerSubject).toBe(
        verifiedIdentity.sub,
      );
      expect(createIdentityCall.data.providerEmail).toBe(
        verifiedIdentity.email,
      );
      expect(result.message).toBe(
        'Google account created and signed in successfully',
      );
      expect(result.user.role).toBe(UserRole.USER);
      expect(authEventLogger.log).toHaveBeenCalledWith(
        'auth.google.account_created',
        expect.objectContaining({ userId: createdUser.id }),
      );
    });

    it('issues a session for a returning Google identity without creating anything', async () => {
      prisma.authIdentity.findUnique.mockResolvedValue({
        user: createdUser,
      });

      const result = await service.google(
        { credential: 'valid.jwt.token' },
        null,
        testLogContext,
      );

      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.authIdentity.create).not.toHaveBeenCalled();
      expect(result.message).toBe('Google sign-in successful');
      expect(authEventLogger.log).toHaveBeenCalledWith(
        'auth.google.succeeded',
        expect.objectContaining({ userId: createdUser.id }),
      );
    });

    it('returns account-link-required when the verified email matches an existing local account with no linked identity', async () => {
      prisma.authIdentity.findUnique.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({
        id: 'existing-user',
        email: verifiedIdentity.email,
      });

      await expect(
        service.google({ credential: 'valid.jwt.token' }, null, testLogContext),
      ).rejects.toBeInstanceOf(AccountLinkRequiredException);

      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.authIdentity.create).not.toHaveBeenCalled();
      expect(authEventLogger.log).toHaveBeenCalledWith(
        'auth.google.link_required',
        expect.any(Object),
      );
    });

    it('resolves a concurrent duplicate-providerSubject race as an ordinary successful login, not a 500', async () => {
      prisma.authIdentity.findUnique
        .mockResolvedValueOnce(null) // initial lookup: not found
        .mockResolvedValueOnce({ user: createdUser }); // re-lookup after the race
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.$transaction.mockRejectedValueOnce(uniqueConstraintError());

      const result = await service.google(
        { credential: 'valid.jwt.token' },
        null,
        testLogContext,
      );

      expect(result.message).toBe('Google sign-in successful');
      expect(authEventLogger.log).toHaveBeenCalledWith(
        'auth.google.succeeded',
        expect.objectContaining({ userId: createdUser.id }),
      );
    });

    it('propagates a non-P2002 error from account creation without swallowing it', async () => {
      prisma.authIdentity.findUnique.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.$transaction.mockRejectedValueOnce(new Error('boom'));

      await expect(
        service.google({ credential: 'valid.jwt.token' }, null, testLogContext),
      ).rejects.toThrow('boom');
    });

    it('logs auth.google.failed and rethrows on an invalid Google credential', async () => {
      googleTokenVerifier.verify.mockRejectedValue(
        new GoogleTokenInvalidError(),
      );

      await expect(
        service.google({ credential: 'bad.jwt.token' }, null, testLogContext),
      ).rejects.toBeInstanceOf(GoogleTokenInvalidError);

      expect(authEventLogger.log).toHaveBeenCalledWith(
        'auth.google.failed',
        expect.objectContaining({ failureCategory: 'invalid_google_token' }),
      );
    });

    it('does not log auth.google.failed when Google sign-in is disabled (503)', async () => {
      googleTokenVerifier.verify.mockRejectedValue(
        new ServiceUnavailableException('Google sign-in is not available'),
      );

      await expect(
        service.google({ credential: 'x.y.z' }, null, testLogContext),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);

      expect(authEventLogger.log).not.toHaveBeenCalled();
    });

    it('never includes the raw credential, email, or sub in any logged payload', async () => {
      prisma.authIdentity.findUnique.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue(createdUser);
      prisma.authIdentity.create.mockResolvedValue({});

      await service.google(
        { credential: 'valid.jwt.token' },
        null,
        testLogContext,
      );

      const serialized = JSON.stringify(authEventLogger.log.mock.calls);
      expect(serialized).not.toContain('valid.jwt.token');
      expect(serialized).not.toContain(verifiedIdentity.email);
      expect(serialized).not.toContain(verifiedIdentity.sub);
    });
  });

  describe('linkGoogle()', () => {
    const localUser = {
      id: 'user-2',
      name: 'Local User',
      email: verifiedIdentity.email,
      password: null as string | null,
      role: UserRole.USER,
      emailVerifiedAt: null as Date | null,
    };

    beforeEach(async () => {
      localUser.password = await argon.hash('correct-password');
      localUser.emailVerifiedAt = null;
    });

    it('links the identity and issues a session when the password matches', async () => {
      prisma.user.findUnique.mockResolvedValue(localUser);
      prisma.authIdentity.create.mockResolvedValue({});
      prisma.user.update.mockResolvedValue({ emailVerifiedAt: new Date() });

      const result = await service.linkGoogle(
        { credential: 'valid.jwt.token', password: 'correct-password' },
        null,
        testLogContext,
      );

      const linkCall = firstCallArg<{
        data: {
          userId: string;
          provider: AuthProvider;
          providerSubject: string;
        };
      }>(prisma.authIdentity.create);
      expect(linkCall.data.userId).toBe(localUser.id);
      expect(linkCall.data.provider).toBe(AuthProvider.GOOGLE);
      expect(linkCall.data.providerSubject).toBe(verifiedIdentity.sub);

      const updateCall = firstCallArg<{
        where: { id: string };
        data: { emailVerifiedAt: Date };
      }>(prisma.user.update);
      expect(updateCall.where).toEqual({ id: localUser.id });
      expect(updateCall.data.emailVerifiedAt).toBeInstanceOf(Date);
      expect(result.message).toBe(
        'Google account linked and signed in successfully',
      );
      expect(authEventLogger.log).toHaveBeenCalledWith(
        'auth.google.identity_linked',
        expect.objectContaining({ userId: localUser.id }),
      );
    });

    it('correct password returns the exact standard issueSession() contract — the same shape every other session-issuing flow returns', async () => {
      prisma.user.findUnique.mockResolvedValue(localUser);
      prisma.authIdentity.create.mockResolvedValue({});
      prisma.user.update.mockResolvedValue({ emailVerifiedAt: new Date() });

      const result = await service.linkGoogle(
        { credential: 'valid.jwt.token', password: 'correct-password' },
        null,
        testLogContext,
      );

      expect(result).toEqual({
        message: 'Google account linked and signed in successfully',
        user: {
          id: localUser.id,
          name: localUser.name,
          email: localUser.email,
          role: localUser.role,
          emailVerified: true,
        },
        accessToken: 'signed.jwt.token',
        refreshCookieValue: 'family-1.secret-1',
      });
      expect(refreshTokenService.issue).toHaveBeenCalledWith(
        localUser.id,
        null,
      );
    });

    it('rejects with a generic 403 on a wrong password', async () => {
      prisma.user.findUnique.mockResolvedValue(localUser);

      await expect(
        service.linkGoogle(
          { credential: 'valid.jwt.token', password: 'wrong-password' },
          null,
          testLogContext,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(prisma.authIdentity.create).not.toHaveBeenCalled();
      expect(authEventLogger.log).toHaveBeenCalledWith(
        'auth.google.link_failed',
        expect.objectContaining({ failureCategory: 'invalid_credentials' }),
      );
    });

    it('rejects with the same generic 403 when the target account is Google-only (no password)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...localUser,
        password: null,
      });

      await expect(
        service.linkGoogle(
          { credential: 'valid.jwt.token', password: 'anything' },
          null,
          testLogContext,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects with the same generic 403 when no account exists for the verified email', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.linkGoogle(
          { credential: 'valid.jwt.token', password: 'anything' },
          null,
          testLogContext,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('treats an already-linked identity (double submit) as an idempotent success, not a 500', async () => {
      prisma.user.findUnique.mockResolvedValue(localUser);
      prisma.authIdentity.create.mockRejectedValue(uniqueConstraintError());
      prisma.user.update.mockResolvedValue({ emailVerifiedAt: new Date() });

      const result = await service.linkGoogle(
        { credential: 'valid.jwt.token', password: 'correct-password' },
        null,
        testLogContext,
      );

      expect(result.message).toBe(
        'Google account linked and signed in successfully',
      );
    });

    it('throws RateLimitExceededException when the verified-email combo bucket is exceeded, before checking the password', async () => {
      rateLimiterService.checkAndIncrement.mockResolvedValue({
        allowed: false,
        count: 999,
      });

      await expect(
        service.linkGoogle(
          { credential: 'valid.jwt.token', password: 'correct-password' },
          null,
          testLogContext,
        ),
      ).rejects.toBeInstanceOf(RateLimitExceededException);

      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('propagates ServiceUnavailableException from the rate limiter (Redis outage) without swallowing it', async () => {
      rateLimiterService.checkAndIncrement.mockRejectedValue(
        new ServiceUnavailableException(),
      );

      await expect(
        service.linkGoogle(
          { credential: 'valid.jwt.token', password: 'correct-password' },
          null,
          testLogContext,
        ),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });
});
