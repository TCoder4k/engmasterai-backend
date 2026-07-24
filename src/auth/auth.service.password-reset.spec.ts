/* eslint-disable @typescript-eslint/unbound-method -- jest.fn() mock references, not real unbound methods */
import * as argon from 'argon2';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
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
import { PasswordReuseException } from './exceptions/password-reuse.exception';
import { sha256Hex } from './utils/hash.util';

const testLogContext: AuthLogContext = {
  requestId: 'test-request-id',
  ipHash: 'test-ip-hash',
};

const firstCallArg = <T>(mockFn: jest.Mock): T =>
  (mockFn.mock.calls as unknown[][])[0][0] as T;

describe('AuthService — password reset (Sprint 02C)', () => {
  let service: AuthService;
  let configService: jest.Mocked<ConfigService>;
  let authEventLogger: jest.Mocked<AuthEventLogger>;
  let refreshTokenService: jest.Mocked<RefreshTokenService>;
  let rateLimiterService: jest.Mocked<RateLimiterService>;
  let transactionalMailService: jest.Mocked<TransactionalMailService>;
  let prisma: {
    user: {
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    passwordResetToken: {
      findUnique: jest.Mock;
      updateMany: jest.Mock;
      create: jest.Mock;
    };
    emailVerificationToken: {
      updateMany: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  const configValues: Record<string, unknown> = {
    JWT_SECRET: 'test-jwt-secret',
    PASSWORD_RESET_TOKEN_TTL_MINUTES: 30,
    PASSWORD_RESET_GOOGLE_NOTICE_ENABLED: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();

    configService = {
      get: jest.fn((key: string) => configValues[key]),
    } as unknown as jest.Mocked<ConfigService>;

    authEventLogger = { log: jest.fn() } as unknown as jest.Mocked<AuthEventLogger>;

    refreshTokenService = {
      revokeAllForUser: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<RefreshTokenService>;

    rateLimiterService = {
      checkAndIncrement: jest.fn().mockResolvedValue({ allowed: true, count: 1 }),
    } as unknown as jest.Mocked<RateLimiterService>;

    transactionalMailService = {
      sendPasswordResetEmail: jest
        .fn()
        .mockResolvedValue({ success: true, durationMs: 42 }),
      sendGoogleOnlyPasswordResetNotice: jest
        .fn()
        .mockResolvedValue({ success: true, durationMs: 10 }),
      sendPasswordResetSuccessNotice: jest
        .fn()
        .mockResolvedValue({ success: true, durationMs: 5 }),
    } as unknown as jest.Mocked<TransactionalMailService>;

    prisma = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      passwordResetToken: {
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({}),
      },
      emailVerificationToken: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      $transaction: jest.fn((arg: unknown) =>
        Array.isArray(arg) ? Promise.all(arg as Promise<unknown>[]) : arg,
      ),
    };

    service = new AuthService(
      prisma as unknown as PrismaService,
      { signAsync: jest.fn() } as unknown as JwtService,
      configService,
      {} as unknown as TokenBlacklistService,
      refreshTokenService,
      authEventLogger,
      {} as unknown as GoogleTokenVerifierService,
      rateLimiterService,
      transactionalMailService,
    );
  });

  describe('forgotPassword()', () => {
    const GENERIC_MESSAGE =
      'If an account exists for this email, a password reset link has been sent.';

    it('returns the generic message and does nothing else for a nonexistent email', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.forgotPassword(
        { email: 'nobody@example.com' },
        testLogContext,
      );

      expect(result).toEqual({ message: GENERIC_MESSAGE });
      expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
      expect(
        transactionalMailService.sendPasswordResetEmail,
      ).not.toHaveBeenCalled();
    });

    it('issues a token and sends the reset email for an eligible local account', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        name: 'Jane',
        email: 'jane@example.com',
        password: 'argon2-hash',
      });

      const result = await service.forgotPassword(
        { email: 'jane@example.com' },
        testLogContext,
      );

      expect(result).toEqual({ message: GENERIC_MESSAGE });
      expect(prisma.passwordResetToken.create).toHaveBeenCalledTimes(1);
      const tokenCreateCall = firstCallArg<{
        data: { userId: string; tokenHash: string; expiresAt: Date };
      }>(prisma.passwordResetToken.create);
      expect(tokenCreateCall.data.userId).toBe('user-1');
      expect(tokenCreateCall.data.tokenHash).toMatch(/^[0-9a-f]{64}$/);

      const sentTo = transactionalMailService.sendPasswordResetEmail.mock
        .calls[0][1] as { rawToken: string };
      expect(tokenCreateCall.data.tokenHash).toBe(sha256Hex(sentTo.rawToken));
    });

    it('invalidates every prior outstanding PasswordResetToken before issuing a new one, in the same transaction', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        name: 'Jane',
        email: 'jane@example.com',
        password: 'argon2-hash',
      });

      await service.forgotPassword({ email: 'jane@example.com' }, testLogContext);

      expect(prisma.passwordResetToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', consumedAt: null },
        data: { consumedAt: expect.any(Date) as Date },
      });
      expect(prisma.$transaction).toHaveBeenCalledWith([
        prisma.passwordResetToken.updateMany.mock.results[0].value,
        prisma.passwordResetToken.create.mock.results[0].value,
      ]);
    });

    it('returns the byte-identical generic response even when the real send fails', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        name: 'Jane',
        email: 'jane@example.com',
        password: 'argon2-hash',
      });
      transactionalMailService.sendPasswordResetEmail.mockResolvedValue({
        success: false,
        failureCategory: 'timeout',
        durationMs: 5000,
      });

      const result = await service.forgotPassword(
        { email: 'jane@example.com' },
        testLogContext,
      );

      expect(result).toEqual({ message: GENERIC_MESSAGE });
      expect(authEventLogger.log).toHaveBeenCalledWith(
        'auth.password_reset.failed',
        expect.objectContaining({ failureCategory: 'timeout' }),
      );
    });

    describe('Google-only account (password === null)', () => {
      beforeEach(() => {
        prisma.user.findUnique.mockResolvedValue({
          id: 'user-1',
          name: 'Jane',
          email: 'jane@example.com',
          password: null,
        });
      });

      it('never creates a PasswordResetToken', async () => {
        await service.forgotPassword(
          { email: 'jane@example.com' },
          testLogContext,
        );
        expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
      });

      it('sends the instructional notice when PASSWORD_RESET_GOOGLE_NOTICE_ENABLED is true, and returns the generic message', async () => {
        const result = await service.forgotPassword(
          { email: 'jane@example.com' },
          testLogContext,
        );

        expect(result).toEqual({ message: GENERIC_MESSAGE });
        expect(
          transactionalMailService.sendGoogleOnlyPasswordResetNotice,
        ).toHaveBeenCalledWith('jane@example.com', { name: 'Jane' });
      });

      it('sends no mail at all when PASSWORD_RESET_GOOGLE_NOTICE_ENABLED is false, and still returns the generic message', async () => {
        configValues.PASSWORD_RESET_GOOGLE_NOTICE_ENABLED = false;

        const result = await service.forgotPassword(
          { email: 'jane@example.com' },
          testLogContext,
        );

        expect(result).toEqual({ message: GENERIC_MESSAGE });
        expect(
          transactionalMailService.sendGoogleOnlyPasswordResetNotice,
        ).not.toHaveBeenCalled();
        expect(
          transactionalMailService.sendPasswordResetEmail,
        ).not.toHaveBeenCalled();

        configValues.PASSWORD_RESET_GOOGLE_NOTICE_ENABLED = true;
      });
    });

    it('never includes the raw email or raw token in any logged payload', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        name: 'Jane',
        email: 'jane@example.com',
        password: 'argon2-hash',
      });

      await service.forgotPassword({ email: 'jane@example.com' }, testLogContext);

      const sentTo = transactionalMailService.sendPasswordResetEmail.mock
        .calls[0][1] as { rawToken: string };
      const serialized = JSON.stringify(authEventLogger.log.mock.calls);
      expect(serialized).not.toContain(sentTo.rawToken);
      expect(serialized).not.toContain('jane@example.com');
    });
  });

  describe('resetPassword()', () => {
    const rawToken = 'a-raw-reset-token';
    const tokenHash = sha256Hex(rawToken);
    const future = new Date(Date.now() + 60_000);
    const past = new Date(Date.now() - 60_000);
    let currentPasswordHash: string;

    beforeAll(async () => {
      currentPasswordHash = await argon.hash('current-password');
    });

    const validTokenRow = (overrides: Record<string, unknown> = {}) => ({
      userId: 'user-1',
      expiresAt: future,
      consumedAt: null,
      user: {
        id: 'user-1',
        name: 'Jane',
        email: 'jane@example.com',
        password: currentPasswordHash,
      },
      ...overrides,
    });

    it('resets the password, consumes every outstanding token, revokes sessions, and sends the success notice', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(validTokenRow());

      const result = await service.resetPassword(
        { token: rawToken, newPassword: 'brand-new-password' },
        'jest-test-agent',
        testLogContext,
      );

      expect(result).toEqual({
        message:
          'Password has been reset successfully. Please log in with your new password.',
      });

      // Password + both token-consumption updates ran in one transaction.
      expect(prisma.$transaction).toHaveBeenCalledWith([
        prisma.user.update.mock.results[0].value,
        prisma.passwordResetToken.updateMany.mock.results[0].value,
        prisma.emailVerificationToken.updateMany.mock.results[0].value,
      ]);
      const userUpdateCall = firstCallArg<{
        where: { id: string };
        data: { password: string };
      }>(prisma.user.update);
      expect(userUpdateCall.where).toEqual({ id: 'user-1' });
      expect(
        await argon.verify(userUpdateCall.data.password, 'brand-new-password'),
      ).toBe(true);

      expect(prisma.passwordResetToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', consumedAt: null },
        data: { consumedAt: expect.any(Date) as Date },
      });
      expect(prisma.emailVerificationToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', consumedAt: null },
        data: { consumedAt: expect.any(Date) as Date },
      });

      expect(refreshTokenService.revokeAllForUser).toHaveBeenCalledWith(
        'user-1',
      );
      expect(authEventLogger.log).toHaveBeenCalledWith(
        'auth.password_reset.sessions_revoked',
        expect.objectContaining({ userId: 'user-1' }),
      );
      expect(
        transactionalMailService.sendPasswordResetSuccessNotice,
      ).toHaveBeenCalledWith('jane@example.com', { name: 'Jane' });

      // No session is issued by this endpoint.
      expect(result).not.toHaveProperty('accessToken');
      expect(result).not.toHaveProperty('refreshCookieValue');
    });

    it('populates a truncated userAgentHash on the completed event, never the raw header', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(validTokenRow());

      await service.resetPassword(
        { token: rawToken, newPassword: 'brand-new-password' },
        'Mozilla/5.0 (jest test agent)',
        testLogContext,
      );

      expect(authEventLogger.log).toHaveBeenCalledWith(
        'auth.password_reset.completed',
        expect.objectContaining({
          userAgentHash: sha256Hex('Mozilla/5.0 (jest test agent)').slice(
            0,
            16,
          ),
        }),
      );
      const serialized = JSON.stringify(authEventLogger.log.mock.calls);
      expect(serialized).not.toContain('Mozilla/5.0 (jest test agent)');
    });

    it('rejects an unknown token generically', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(null);

      await expect(
        service.resetPassword(
          { token: 'forged', newPassword: 'brand-new-password' },
          null,
          testLogContext,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(authEventLogger.log).toHaveBeenCalledWith(
        'auth.password_reset.invalid',
        expect.objectContaining({ failureCategory: 'invalid_token' }),
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects an expired token generically, logged distinctly as expired', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(
        validTokenRow({ expiresAt: past }),
      );

      await expect(
        service.resetPassword(
          { token: rawToken, newPassword: 'brand-new-password' },
          null,
          testLogContext,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(authEventLogger.log).toHaveBeenCalledWith(
        'auth.password_reset.expired',
        expect.objectContaining({ failureCategory: 'token_expired' }),
      );
    });

    it('rejects an already-consumed token generically — no idempotent-success softening (asymmetry from email verification)', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(
        validTokenRow({ consumedAt: new Date() }),
      );

      await expect(
        service.resetPassword(
          { token: rawToken, newPassword: 'brand-new-password' },
          null,
          testLogContext,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(authEventLogger.log).toHaveBeenCalledWith(
        'auth.password_reset.invalid',
        expect.objectContaining({ failureCategory: 'token_consumed' }),
      );
    });

    it('defense-in-depth: rejects a token that somehow exists for a Google-only (password===null) account', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(
        validTokenRow({ user: { id: 'user-1', name: 'Jane', email: 'jane@example.com', password: null } }),
      );

      await expect(
        service.resetPassword(
          { token: rawToken, newPassword: 'brand-new-password' },
          null,
          testLogContext,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    describe('password-reuse rejection', () => {
      it('rejects a newPassword identical to the current password with PasswordReuseException, WITHOUT consuming the token', async () => {
        prisma.passwordResetToken.findUnique.mockResolvedValue(validTokenRow());

        await expect(
          service.resetPassword(
            { token: rawToken, newPassword: 'current-password' },
            null,
            testLogContext,
          ),
        ).rejects.toBeInstanceOf(PasswordReuseException);

        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(prisma.user.update).not.toHaveBeenCalled();
        expect(refreshTokenService.revokeAllForUser).not.toHaveBeenCalled();
        expect(
          transactionalMailService.sendPasswordResetSuccessNotice,
        ).not.toHaveBeenCalled();
        expect(authEventLogger.log).toHaveBeenCalledWith(
          'auth.password_reset.reuse_rejected',
          expect.objectContaining({ userId: 'user-1' }),
        );
      });

      it('permits an immediate retry with a different password using the same token after a reuse rejection', async () => {
        prisma.passwordResetToken.findUnique.mockResolvedValue(validTokenRow());

        await expect(
          service.resetPassword(
            { token: rawToken, newPassword: 'current-password' },
            null,
            testLogContext,
          ),
        ).rejects.toBeInstanceOf(PasswordReuseException);

        // Same token presented again, this time with a genuinely new password.
        const result = await service.resetPassword(
          { token: rawToken, newPassword: 'a-genuinely-new-password' },
          null,
          testLogContext,
        );
        expect(result.message).toMatch(/reset successfully/);
      });
    });

    describe('Redis revocation failure at the post-commit step', () => {
      it('still returns success and logs an alert-worthy event when revokeAllForUser() throws ServiceUnavailableException', async () => {
        prisma.passwordResetToken.findUnique.mockResolvedValue(validTokenRow());
        refreshTokenService.revokeAllForUser.mockRejectedValue(
          new ServiceUnavailableException(),
        );

        const result = await service.resetPassword(
          { token: rawToken, newPassword: 'brand-new-password' },
          null,
          testLogContext,
        );

        expect(result.message).toMatch(/reset successfully/);
        expect(authEventLogger.log).toHaveBeenCalledWith(
          'auth.password_reset.revocation_failed',
          expect.objectContaining({ userId: 'user-1' }),
        );
        // The password change itself is not undone.
        expect(prisma.user.update).toHaveBeenCalledTimes(1);
      });

      it('propagates a genuinely unexpected (non-Redis) error from revokeAllForUser rather than swallowing it', async () => {
        prisma.passwordResetToken.findUnique.mockResolvedValue(validTokenRow());
        refreshTokenService.revokeAllForUser.mockRejectedValue(
          new Error('unexpected programmer error'),
        );

        await expect(
          service.resetPassword(
            { token: rawToken, newPassword: 'brand-new-password' },
            null,
            testLogContext,
          ),
        ).rejects.toThrow('unexpected programmer error');
      });
    });

    it('does not throw and still returns success when the success-notice email fails', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(validTokenRow());
      transactionalMailService.sendPasswordResetSuccessNotice.mockResolvedValue(
        { success: false, failureCategory: 'network_error', durationMs: 20 },
      );

      const result = await service.resetPassword(
        { token: rawToken, newPassword: 'brand-new-password' },
        null,
        testLogContext,
      );

      expect(result.message).toMatch(/reset successfully/);
      expect(authEventLogger.log).toHaveBeenCalledWith(
        'auth.password_reset.notice_failed',
        expect.objectContaining({ failureCategory: 'network_error' }),
      );
    });

    it('never includes the raw token or raw new password in any logged payload', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(validTokenRow());

      await service.resetPassword(
        { token: rawToken, newPassword: 'super-secret-new-password' },
        null,
        testLogContext,
      );

      const serialized = JSON.stringify(authEventLogger.log.mock.calls);
      expect(serialized).not.toContain(rawToken);
      expect(serialized).not.toContain('super-secret-new-password');
    });
  });
});
