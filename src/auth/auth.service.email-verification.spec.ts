/* eslint-disable @typescript-eslint/unbound-method -- jest.fn() mock references, not real unbound methods */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
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
import { RateLimitExceededException } from './exceptions/rate-limit-exceeded.exception';
import { TransactionalMailService } from '../mail/transactional-mail.service';
import { sha256Hex } from './utils/hash.util';

const testLogContext: AuthLogContext = {
  requestId: 'test-request-id',
  ipHash: 'test-ip-hash',
};

const firstCallArg = <T>(mockFn: jest.Mock): T =>
  (mockFn.mock.calls as unknown[][])[0][0] as T;

describe('AuthService — email verification (Sprint 02B)', () => {
  let service: AuthService;
  let jwtService: jest.Mocked<JwtService>;
  let configService: jest.Mocked<ConfigService>;
  let authEventLogger: jest.Mocked<AuthEventLogger>;
  let refreshTokenService: jest.Mocked<RefreshTokenService>;
  let rateLimiterService: jest.Mocked<RateLimiterService>;
  let transactionalMailService: jest.Mocked<TransactionalMailService>;
  let prisma: {
    user: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    emailVerificationToken: {
      findUnique: jest.Mock;
      updateMany: jest.Mock;
      create: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  const configValues: Record<string, unknown> = {
    JWT_SECRET: 'test-jwt-secret',
    EMAIL_VERIFICATION_TOKEN_TTL_MINUTES: 30,
    AUTH_EMAIL_VERIFY_RESEND_USER_RATE_LIMIT_MAX: 3,
    AUTH_EMAIL_VERIFY_RESEND_RATE_LIMIT_WINDOW_SECONDS: 900,
  };

  beforeEach(() => {
    jwtService = {
      signAsync: jest.fn().mockResolvedValue('signed.jwt.token'),
    } as unknown as jest.Mocked<JwtService>;

    configService = {
      get: jest.fn((key: string) => configValues[key]),
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

    rateLimiterService = {
      checkAndIncrement: jest
        .fn()
        .mockResolvedValue({ allowed: true, count: 1 }),
    } as unknown as jest.Mocked<RateLimiterService>;

    transactionalMailService = {
      sendVerificationEmail: jest.fn().mockResolvedValue({
        success: true,
        durationMs: 42,
      }),
    } as unknown as jest.Mocked<TransactionalMailService>;

    prisma = {
      user: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      emailVerificationToken: {
        findUnique: jest.fn(),
        updateMany: jest.fn(),
        create: jest.fn(),
      },
      $transaction: jest.fn((arg: unknown) =>
        Array.isArray(arg) ? Promise.all(arg as Promise<unknown>[]) : arg,
      ),
    };

    service = new AuthService(
      prisma as unknown as PrismaService,
      jwtService,
      configService,
      {} as unknown as TokenBlacklistService,
      refreshTokenService,
      authEventLogger,
      {} as unknown as GoogleTokenVerifierService,
      rateLimiterService,
      transactionalMailService,
    );
  });

  describe('register() — verification-email integration', () => {
    const dto = {
      name: 'Jane',
      email: '  Jane@Example.COM ',
      password: 'password123',
    };

    beforeEach(() => {
      prisma.user.create.mockResolvedValue({
        id: 'user-1',
        name: dto.name,
        email: 'jane@example.com',
        role: UserRole.USER,
        emailVerifiedAt: null,
        createdAt: new Date(),
      });
      prisma.emailVerificationToken.updateMany.mockResolvedValue({ count: 0 });
      prisma.emailVerificationToken.create.mockResolvedValue({});
    });

    it('normalizes the submitted email before writing it', async () => {
      await service.register(dto, null, testLogContext);

      const createCall = firstCallArg<{ data: { email: string } }>(
        prisma.user.create,
      );
      expect(createCall.data.email).toBe('jane@example.com');
    });

    it('leaves emailVerifiedAt null for a newly registered local user', async () => {
      const result = await service.register(dto, null, testLogContext);

      const createCall = firstCallArg<{ data: Record<string, unknown> }>(
        prisma.user.create,
      );
      expect(createCall.data).not.toHaveProperty('emailVerifiedAt');
      expect(result.user.emailVerified).toBe(false);
    });

    it('stores only the token hash — never the raw token', async () => {
      await service.register(dto, null, testLogContext);

      const tokenCreateCall = firstCallArg<{
        data: { userId: string; tokenHash: string; expiresAt: Date };
      }>(prisma.emailVerificationToken.create);
      expect(tokenCreateCall.data.userId).toBe('user-1');
      expect(tokenCreateCall.data.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(tokenCreateCall.data.expiresAt).toBeInstanceOf(Date);

      const sentTo = transactionalMailService.sendVerificationEmail.mock
        .calls[0][1] as { rawToken: string };
      expect(tokenCreateCall.data.tokenHash).toBe(sha256Hex(sentTo.rawToken));
    });

    it('invalidates any prior outstanding tokens for the user before issuing a new one, in the same transaction', async () => {
      await service.register(dto, null, testLogContext);

      expect(prisma.emailVerificationToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', consumedAt: null },
        data: { consumedAt: expect.any(Date) as Date },
      });
      expect(prisma.$transaction).toHaveBeenCalledWith([
        prisma.emailVerificationToken.updateMany.mock.results[0].value,
        prisma.emailVerificationToken.create.mock.results[0].value,
      ]);
    });

    it('awaits TransactionalMailService and reports emailDeliveryStatus: "sent" on success', async () => {
      const result = await service.register(dto, null, testLogContext);

      expect(
        transactionalMailService.sendVerificationEmail,
      ).toHaveBeenCalledWith(
        'jane@example.com',
        expect.objectContaining({ name: 'Jane' }),
      );
      expect(result.emailDeliveryStatus).toBe('sent');
    });

    it('reports emailDeliveryStatus: "failed", but still returns a successful registration, when the provider times out', async () => {
      transactionalMailService.sendVerificationEmail.mockResolvedValue({
        success: false,
        failureCategory: 'timeout',
        durationMs: 5000,
      });

      const result = await service.register(dto, null, testLogContext);

      expect(result.emailDeliveryStatus).toBe('failed');
      expect(result.message).toBe('Registration successful');
      expect(result.accessToken).toBeTruthy();
    });

    it('does not roll back / does not throw when the provider rejects the send — the already-created user is still returned', async () => {
      transactionalMailService.sendVerificationEmail.mockResolvedValue({
        success: false,
        failureCategory: 'provider_rejected',
        durationMs: 10,
      });

      await expect(
        service.register(dto, null, testLogContext),
      ).resolves.toMatchObject({ emailDeliveryStatus: 'failed' });
      expect(prisma.user.create).toHaveBeenCalledTimes(1);
    });

    it('never lets an unexpected error from the mail path propagate out of register() (no unhandled rejection)', async () => {
      transactionalMailService.sendVerificationEmail.mockRejectedValue(
        new Error('unexpected mail-path crash'),
      );

      const result = await service.register(dto, null, testLogContext);

      expect(result.emailDeliveryStatus).toBe('failed');
      expect(result.accessToken).toBeTruthy();
    });

    it('never includes the raw token, raw email, or provider error detail in any logged payload', async () => {
      await service.register(dto, null, testLogContext);

      const sentTo = transactionalMailService.sendVerificationEmail.mock
        .calls[0][1] as { rawToken: string };
      const serialized = JSON.stringify(authEventLogger.log.mock.calls);
      expect(serialized).not.toContain(sentTo.rawToken);
      expect(serialized).not.toContain('jane@example.com');
    });
  });

  describe('verifyEmail()', () => {
    const rawToken = 'a-raw-verification-token';
    const tokenHash = sha256Hex(rawToken);
    const future = new Date(Date.now() + 60_000);
    const past = new Date(Date.now() - 60_000);

    it('verifies a valid, unconsumed, unexpired token and sets emailVerifiedAt', async () => {
      prisma.emailVerificationToken.findUnique.mockResolvedValue({
        userId: 'user-1',
        expiresAt: future,
        user: { emailVerifiedAt: null },
      });
      prisma.emailVerificationToken.updateMany.mockResolvedValue({ count: 1 });
      prisma.user.update.mockResolvedValue({});

      const result = await service.verifyEmail(
        { token: rawToken },
        testLogContext,
      );

      expect(result).toEqual({ message: 'Email verified successfully.' });
      expect(prisma.emailVerificationToken.updateMany).toHaveBeenCalledWith({
        where: {
          tokenHash,
          consumedAt: null,
          expiresAt: { gt: expect.any(Date) as Date },
        },
        data: { consumedAt: expect.any(Date) as Date },
      });
      const updateCall = firstCallArg<{
        where: { id: string };
        data: { emailVerifiedAt: Date };
      }>(prisma.user.update);
      expect(updateCall.where).toEqual({ id: 'user-1' });
      expect(updateCall.data.emailVerifiedAt).toBeInstanceOf(Date);
      expect(authEventLogger.log).toHaveBeenCalledWith(
        'auth.email_verification.completed',
        expect.objectContaining({ userId: 'user-1' }),
      );
    });

    it('does not rewrite an already-set emailVerifiedAt timestamp (idempotent, no unnecessary write)', async () => {
      const alreadyVerifiedAt = new Date('2026-01-01T00:00:00Z');
      prisma.emailVerificationToken.findUnique.mockResolvedValue({
        userId: 'user-1',
        expiresAt: future,
        user: { emailVerifiedAt: alreadyVerifiedAt },
      });
      prisma.emailVerificationToken.updateMany.mockResolvedValue({ count: 1 });

      await service.verifyEmail({ token: rawToken }, testLogContext);

      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects an unknown/forged token with a generic message', async () => {
      prisma.emailVerificationToken.findUnique.mockResolvedValue(null);

      await expect(
        service.verifyEmail({ token: 'forged' }, testLogContext),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(authEventLogger.log).toHaveBeenCalledWith(
        'auth.email_verification.invalid',
        expect.any(Object),
      );
    });

    it('rejects an expired token with the same generic message, logged distinctly as expired', async () => {
      prisma.emailVerificationToken.findUnique.mockResolvedValue({
        userId: 'user-1',
        expiresAt: past,
        user: { emailVerifiedAt: null },
      });
      prisma.emailVerificationToken.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.verifyEmail({ token: rawToken }, testLogContext),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(authEventLogger.log).toHaveBeenCalledWith(
        'auth.email_verification.expired',
        expect.any(Object),
      );
    });

    it('rejects an already-consumed token belonging to a still-unverified account with the generic message (not the already-verified branch)', async () => {
      prisma.emailVerificationToken.findUnique.mockResolvedValue({
        userId: 'user-1',
        expiresAt: future,
        user: { emailVerifiedAt: null },
      });
      prisma.emailVerificationToken.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.verifyEmail({ token: rawToken }, testLogContext),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(authEventLogger.log).toHaveBeenCalledWith(
        'auth.email_verification.invalid',
        expect.any(Object),
      );
    });

    it('treats a replay of a token whose account is already verified as an idempotent success, not an error', async () => {
      prisma.emailVerificationToken.findUnique.mockResolvedValue({
        userId: 'user-1',
        expiresAt: future,
        user: { emailVerifiedAt: new Date() },
      });
      prisma.emailVerificationToken.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.verifyEmail(
        { token: rawToken },
        testLogContext,
      );

      expect(result).toEqual({
        message: 'Your email is already verified.',
        alreadyVerified: true,
      });
      expect(authEventLogger.log).toHaveBeenCalledWith(
        'auth.email_verification.already_verified',
        expect.any(Object),
      );
    });

    it('consumes a token exactly once under a simulated concurrent race — the loser gets the generic rejection, not a crash', async () => {
      prisma.emailVerificationToken.findUnique
        .mockResolvedValueOnce({
          userId: 'user-1',
          expiresAt: future,
          user: { emailVerifiedAt: null },
        })
        .mockResolvedValueOnce({
          userId: 'user-1',
          expiresAt: future,
          user: { emailVerifiedAt: null },
        });
      // First caller's atomic updateMany wins (count: 1); the second
      // caller's identical call loses (count: 0) — exactly what Postgres's
      // row-level locking under a real concurrent UPDATE would produce.
      prisma.emailVerificationToken.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });
      prisma.user.update.mockResolvedValue({});

      const winner = await service.verifyEmail(
        { token: rawToken },
        testLogContext,
      );
      await expect(
        service.verifyEmail({ token: rawToken }, testLogContext),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(winner).toEqual({ message: 'Email verified successfully.' });
      expect(prisma.user.update).toHaveBeenCalledTimes(1);
    });

    it('never includes the raw token in any logged payload', async () => {
      prisma.emailVerificationToken.findUnique.mockResolvedValue(null);

      await expect(
        service.verifyEmail({ token: rawToken }, testLogContext),
      ).rejects.toBeInstanceOf(BadRequestException);

      const serialized = JSON.stringify(authEventLogger.log.mock.calls);
      expect(serialized).not.toContain(rawToken);
    });
  });

  describe('resendVerification()', () => {
    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        name: 'Jane',
        email: 'jane@example.com',
        emailVerifiedAt: null,
      });
      prisma.emailVerificationToken.updateMany.mockResolvedValue({ count: 0 });
      prisma.emailVerificationToken.create.mockResolvedValue({});
    });

    it('issues a fresh token and sends it, reporting delivered: true on success', async () => {
      const result = await service.resendVerification('user-1', testLogContext);

      expect(result).toEqual({
        message: 'Verification email sent.',
        delivered: true,
      });
      expect(prisma.emailVerificationToken.create).toHaveBeenCalledTimes(1);
    });

    it('reports delivered: false without throwing when the provider fails', async () => {
      transactionalMailService.sendVerificationEmail.mockResolvedValue({
        success: false,
        failureCategory: 'provider_rejected',
        durationMs: 10,
      });

      const result = await service.resendVerification('user-1', testLogContext);

      expect(result.delivered).toBe(false);
      expect(result.message).toMatch(/could not send/i);
    });

    it('returns the idempotent already-verified response and sends nothing when the account is already verified', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        name: 'Jane',
        email: 'jane@example.com',
        emailVerifiedAt: new Date(),
      });

      const result = await service.resendVerification('user-1', testLogContext);

      expect(result).toEqual({ message: 'Your email is already verified.' });
      expect(
        transactionalMailService.sendVerificationEmail,
      ).not.toHaveBeenCalled();
      expect(prisma.emailVerificationToken.create).not.toHaveBeenCalled();
    });

    it('throws RateLimitExceededException when the user-scoped bucket is exceeded, before any DB lookup', async () => {
      rateLimiterService.checkAndIncrement.mockResolvedValue({
        allowed: false,
        count: 999,
      });

      await expect(
        service.resendVerification('user-1', testLogContext),
      ).rejects.toBeInstanceOf(RateLimitExceededException);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('keys the rate-limit bucket on the server-derived userId, never a client-supplied value', async () => {
      await service.resendVerification('user-1', testLogContext);

      expect(rateLimiterService.checkAndIncrement).toHaveBeenCalledWith(
        expect.stringContaining('user-1'),
        expect.any(Number),
        expect.any(Number),
      );
    });

    it('throws NotFoundException defensively when the authenticated user no longer exists', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.resendVerification('deleted-user', testLogContext),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
