import {
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GoogleAuthDTO, GoogleLinkDTO, LoginDTO, RegisterDTO } from './dto';
import * as argon from 'argon2';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthProvider, Prisma, UserRole } from '@prisma/client';
import { TokenBlacklistService } from './token-blacklist.service';
import { RefreshTokenService } from './refresh-token.service';
import { extractBearerToken } from './utils/extract-bearer-token';
import { sha256Hex } from './utils/hash.util';
import {
  AuthEventLogger,
  AuthLogContext,
} from './logging/auth-event-logger.service';
import {
  emailHashPrefix,
  googleLinkComboKey,
} from './rate-limit/rate-limit-key.util';
import {
  GoogleTokenVerifierService,
  VerifiedGoogleIdentity,
} from './google/google-token-verifier.service';
import { RateLimiterService } from './rate-limit/rate-limiter.service';
import { RateLimitExceededException } from './exceptions/rate-limit-exceeded.exception';
import { AccountLinkRequiredException } from './exceptions/account-link-required.exception';

export interface AuthResult {
  message: string;
  user: {
    id: string;
    name: string;
    email: string;
    role: UserRole;
  };
  accessToken: string;
  // Encoded `<familyId>.<secret>` refresh-cookie value. Never part of the
  // JSON response body — the controller sets it as an httpOnly cookie and
  // strips this field before returning the body to the client.
  refreshCookieValue: string;
}

export interface RefreshResult {
  accessToken: string;
  refreshCookieValue: string;
}

// Type-safe narrowing for Prisma's unique-constraint-violation error, used
// by the Sprint 02A concurrent-first-login and already-linked-identity race
// handling below — avoids an unsafe `.code` access on a caught `unknown`.
const isUniqueConstraintViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2002';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prismaService: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private tokenBlacklistService: TokenBlacklistService,
    private refreshTokenService: RefreshTokenService,
    private authEventLogger: AuthEventLogger,
    private googleTokenVerifier: GoogleTokenVerifierService,
    private rateLimiterService: RateLimiterService,
  ) {}

  async register(
    dto: RegisterDTO,
    userAgent: string | null,
    logContext: AuthLogContext,
  ): Promise<AuthResult> {
    const startedAt = Date.now();
    const route = 'POST /auth/register';

    try {
      // Hash password securely
      const hashedPassword = await argon.hash(dto.password);

      // Create user with USER role (registration is for learners only)
      const user = await this.prismaService.user.create({
        data: {
          name: dto.name,
          email: dto.email,
          password: hashedPassword,
          role: UserRole.USER, // USER role = learner
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          createdAt: true,
        },
      });

      this.authEventLogger.log('auth.register.succeeded', {
        requestId: logContext.requestId,
        route,
        durationMs: Date.now() - startedAt,
        userId: user.id,
        role: user.role,
        ipHash: logContext.ipHash,
      });

      return this.issueSession(user, userAgent, 'Registration successful');
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;

      // Sprint 01C: a duplicate email and any other registration failure
      // collapse onto the same generic `registration_failed` category in
      // the structured event log — no distinct "email already taken"
      // category, per the sprint's enumeration-avoidance intent.
      this.authEventLogger.log('auth.register.failed', {
        requestId: logContext.requestId,
        route,
        durationMs: Date.now() - startedAt,
        emailHash: emailHashPrefix(dto.email),
        ipHash: logContext.ipHash,
        failureCategory: 'registration_failed',
      });

      if (error.code === 'P2002') {
        throw new ForbiddenException('Email already exists');
      }
      this.logger.error('Registration failed', error as Error);
      throw new ForbiddenException('Registration failed');
    }
  }

  async login(
    dto: LoginDTO,
    userAgent: string | null,
    logContext: AuthLogContext,
  ): Promise<AuthResult> {
    const startedAt = Date.now();
    const route = 'POST /auth/login';
    const emailHash = emailHashPrefix(dto.email);

    // Every login failure branch below (not-found, role-mismatch,
    // wrong-password) collapses onto the same generic `invalid_credentials`
    // category — Sprint 01C's enumeration-avoidance requirement: the log
    // must not let a reader distinguish "no such account" from "wrong
    // password" from "right password, wrong role".
    const logFailure = (): void => {
      this.authEventLogger.log('auth.login.failed', {
        requestId: logContext.requestId,
        route,
        durationMs: Date.now() - startedAt,
        emailHash,
        ipHash: logContext.ipHash,
        failureCategory: 'invalid_credentials',
      });
    };

    // Find user by email
    const user = await this.prismaService.user.findUnique({
      where: {
        email: dto.email,
      },
      select: {
        id: true,
        name: true,
        email: true,
        password: true,
        role: true,
      },
    });

    // Check if user exists
    if (!user) {
      logFailure();
      throw new ForbiddenException('Invalid credentials');
    }

    // Verify role matches
    if (user.role !== dto.role) {
      logFailure();
      throw new ForbiddenException('Invalid credentials or unauthorized role');
    }

    // A Google-only account (Sprint 02A) has no local password. Collapsed
    // onto the exact same generic failure as every other branch here —
    // never a distinct "this account uses Google" message — so an
    // unauthenticated caller can't use this to enumerate how an account
    // was created.
    if (!user.password) {
      logFailure();
      throw new ForbiddenException('Invalid credentials');
    }

    // Verify password
    const passwordMatched = await argon.verify(user.password, dto.password);

    if (!passwordMatched) {
      logFailure();
      throw new ForbiddenException('Invalid credentials');
    }

    this.authEventLogger.log('auth.login.succeeded', {
      requestId: logContext.requestId,
      route,
      durationMs: Date.now() - startedAt,
      userId: user.id,
      role: user.role,
      ipHash: logContext.ipHash,
    });

    return this.issueSession(user, userAgent, 'Login successful');
  }

  /**
   * POST /auth/google — Google is only an identity provider here. Every
   * downstream decision uses fields from `verified` (the backend-verified
   * token payload) only; nothing from the raw request body is ever trusted.
   * Never auto-links an existing local account on an email match — see
   * docs/adr/004-google-auth.md's account-linking policy.
   */
  async google(
    dto: GoogleAuthDTO,
    userAgent: string | null,
    logContext: AuthLogContext,
  ): Promise<AuthResult> {
    const startedAt = Date.now();
    const route = 'POST /auth/google';

    let verified: VerifiedGoogleIdentity;
    try {
      verified = await this.googleTokenVerifier.verify(dto.credential);
    } catch (error) {
      // Feature disabled (503) is not a credential failure — nothing to log.
      if (error instanceof ServiceUnavailableException) throw error;
      this.authEventLogger.log('auth.google.failed', {
        requestId: logContext.requestId,
        route,
        durationMs: Date.now() - startedAt,
        ipHash: logContext.ipHash,
        failureCategory: 'invalid_google_token',
      });
      throw error;
    }

    const emailHash = emailHashPrefix(verified.email);
    const subjectHash = sha256Hex(verified.sub).slice(0, 16);

    const existingIdentity = await this.findGoogleIdentity(verified.sub);
    if (existingIdentity) {
      this.authEventLogger.log('auth.google.succeeded', {
        requestId: logContext.requestId,
        route,
        durationMs: Date.now() - startedAt,
        userId: existingIdentity.user.id,
        role: existingIdentity.user.role,
        ipHash: logContext.ipHash,
        provider: 'google',
      });
      return this.issueSession(
        existingIdentity.user,
        userAgent,
        'Google sign-in successful',
      );
    }

    const existingUserByEmail = await this.prismaService.user.findUnique({
      where: { email: verified.email },
    });
    if (existingUserByEmail) {
      this.authEventLogger.log('auth.google.link_required', {
        requestId: logContext.requestId,
        route,
        durationMs: Date.now() - startedAt,
        ipHash: logContext.ipHash,
        emailHash,
        provider: 'google',
        providerSubjectHash: subjectHash,
      });
      throw new AccountLinkRequiredException(verified.email);
    }

    try {
      const user = await this.createGoogleUser(verified);
      this.authEventLogger.log('auth.google.account_created', {
        requestId: logContext.requestId,
        route,
        durationMs: Date.now() - startedAt,
        userId: user.id,
        role: user.role,
        ipHash: logContext.ipHash,
        provider: 'google',
      });
      return this.issueSession(
        user,
        userAgent,
        'Google account created and signed in successfully',
      );
    } catch (error) {
      if (!isUniqueConstraintViolation(error)) throw error;

      // Concurrent first-login race for the same Google identity: exactly
      // one attempt wins the unique constraint. Re-resolve from scratch
      // rather than assuming which constraint fired.
      const raceIdentity = await this.findGoogleIdentity(verified.sub);
      if (raceIdentity) {
        this.authEventLogger.log('auth.google.succeeded', {
          requestId: logContext.requestId,
          route,
          durationMs: Date.now() - startedAt,
          userId: raceIdentity.user.id,
          role: raceIdentity.user.role,
          ipHash: logContext.ipHash,
          provider: 'google',
        });
        return this.issueSession(
          raceIdentity.user,
          userAgent,
          'Google sign-in successful',
        );
      }

      // A different collision (e.g. a local registration just took this
      // email) — never silently proceed; the safe fallback is the same
      // link-required path a pre-existing account would have taken.
      this.authEventLogger.log('auth.google.link_required', {
        requestId: logContext.requestId,
        route,
        durationMs: Date.now() - startedAt,
        ipHash: logContext.ipHash,
        emailHash,
        provider: 'google',
        providerSubjectHash: subjectHash,
      });
      throw new AccountLinkRequiredException(verified.email);
    }
  }

  /**
   * POST /auth/google/link — links a Google identity to an existing local
   * account, gated on proving knowledge of that account's current password.
   * Re-verifies the Google credential from scratch (never trusts that an
   * earlier /auth/google call already verified it) and checks a
   * backend-verified-identity rate-limit bucket before the password check,
   * since this endpoint is functionally a password-verification oracle.
   */
  async linkGoogle(
    dto: GoogleLinkDTO,
    userAgent: string | null,
    logContext: AuthLogContext,
  ): Promise<AuthResult> {
    const startedAt = Date.now();
    const route = 'POST /auth/google/link';

    let verified: VerifiedGoogleIdentity;
    try {
      verified = await this.googleTokenVerifier.verify(dto.credential);
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      this.authEventLogger.log('auth.google.link_failed', {
        requestId: logContext.requestId,
        route,
        durationMs: Date.now() - startedAt,
        ipHash: logContext.ipHash,
        failureCategory: 'invalid_google_token',
      });
      throw error;
    }

    const emailHash = emailHashPrefix(verified.email);

    // Guard-level @RateLimits already checked an IP-only bucket before this
    // method ran. This second bucket is keyed on the backend-verified
    // email — never a client-supplied claim — and is only checkable here,
    // after verification.
    const comboMax = this.configService.get<number>(
      'AUTH_GOOGLE_LINK_RATE_LIMIT_MAX',
    ) as number;
    const comboWindow = this.configService.get<number>(
      'AUTH_GOOGLE_LINK_RATE_LIMIT_WINDOW_SECONDS',
    ) as number;
    const comboResult = await this.rateLimiterService.checkAndIncrement(
      googleLinkComboKey(logContext.ipHash, emailHash),
      comboMax,
      comboWindow,
    );
    if (!comboResult.allowed) {
      this.authEventLogger.log('auth.rate_limit.exceeded', {
        requestId: logContext.requestId,
        route,
        ipHash: logContext.ipHash,
        emailHash,
        failureCategory: 'google-link-combo',
      });
      throw new RateLimitExceededException();
    }

    const logFailure = (): void => {
      this.authEventLogger.log('auth.google.link_failed', {
        requestId: logContext.requestId,
        route,
        durationMs: Date.now() - startedAt,
        emailHash,
        ipHash: logContext.ipHash,
        failureCategory: 'invalid_credentials',
      });
    };

    const user = await this.prismaService.user.findUnique({
      where: { email: verified.email },
      select: {
        id: true,
        name: true,
        email: true,
        password: true,
        role: true,
        emailVerifiedAt: true,
      },
    });

    // Unknown email, and a Google-only target account (no password to
    // verify against) both collapse onto the exact same generic failure —
    // matching login()'s own enumeration-avoidance treatment.
    if (!user || !user.password) {
      logFailure();
      throw new ForbiddenException('Invalid credentials');
    }

    const passwordMatched = await argon.verify(user.password, dto.password);
    if (!passwordMatched) {
      logFailure();
      throw new ForbiddenException('Invalid credentials');
    }

    try {
      await this.prismaService.authIdentity.create({
        data: {
          userId: user.id,
          provider: AuthProvider.GOOGLE,
          providerSubject: verified.sub,
          providerEmail: verified.email,
        },
      });
    } catch (error) {
      // Double-submit / already-linked race — idempotent success, not a
      // 500; fall through and issue a session either way.
      if (!isUniqueConstraintViolation(error)) throw error;
    }

    if (!user.emailVerifiedAt) {
      await this.prismaService.user.update({
        where: { id: user.id },
        data: { emailVerifiedAt: new Date() },
      });
    }

    this.authEventLogger.log('auth.google.identity_linked', {
      requestId: logContext.requestId,
      route,
      durationMs: Date.now() - startedAt,
      userId: user.id,
      role: user.role,
      ipHash: logContext.ipHash,
      provider: 'google',
    });

    return this.issueSession(
      user,
      userAgent,
      'Google account linked and signed in successfully',
    );
  }

  private async findGoogleIdentity(providerSubject: string) {
    return this.prismaService.authIdentity.findUnique({
      where: {
        provider_providerSubject: {
          provider: AuthProvider.GOOGLE,
          providerSubject,
        },
      },
      include: { user: true },
    });
  }

  private async createGoogleUser(verified: VerifiedGoogleIdentity): Promise<{
    id: string;
    name: string;
    email: string;
    role: UserRole;
  }> {
    return this.prismaService.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: verified.name,
          email: verified.email,
          password: null,
          role: UserRole.USER,
          avatarUrl: verified.picture ?? null,
          // The backend has just cryptographically verified email ownership
          // (email_verified=true on the Google ID token) — see the User
          // model's emailVerifiedAt doc comment for how a future
          // email-verification sprint is expected to consume this.
          emailVerifiedAt: new Date(),
        },
        select: { id: true, name: true, email: true, role: true },
      });
      await tx.authIdentity.create({
        data: {
          userId: user.id,
          provider: AuthProvider.GOOGLE,
          providerSubject: verified.sub,
          providerEmail: verified.email,
        },
      });
      return user;
    });
  }

  private async issueRefreshCookieValue(
    userId: string,
    userAgent: string | null,
  ): Promise<string> {
    const { familyId, secret } = await this.refreshTokenService.issue(
      userId,
      userAgent,
    );
    return this.refreshTokenService.encodeCookieValue(familyId, secret);
  }

  /**
   * The single path that turns "we know which User this is" into an issued
   * session — a JWT access token plus a fresh rotating refresh cookie value.
   * register(), login(), google(), and linkGoogle() all funnel through this
   * one method rather than each re-deriving the token/cookie shape.
   */
  private async issueSession(
    user: { id: string; name: string; email: string; role: UserRole },
    userAgent: string | null,
    message: string,
  ): Promise<AuthResult> {
    const { accessToken } = await this.signJwtToken(
      user.id,
      user.email,
      user.role,
    );
    const refreshCookieValue = await this.issueRefreshCookieValue(
      user.id,
      userAgent,
    );

    return {
      message,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      accessToken,
      refreshCookieValue,
    };
  }

  //Phát hành token
  async signJwtToken(
    userid: string,
    email: string,
    role: UserRole,
  ): Promise<{ accessToken: string }> {
    //Tạo payload jwt(thông tin nhét vào token)
    const payload = {
      sub: userid,
      email,
      role,
    };
    //Ký jwt (đóng dấu vào thẻ)
    const jwtString = await this.jwtService.signAsync(payload, {
      expiresIn: '10m',
      secret: this.configService.get<string>('JWT_SECRET'),
    });
    //trả token
    return {
      accessToken: jwtString,
    };
  }

  /**
   * Rotates a refresh session and issues a fresh access token. Strict
   * single-use, no grace window (Sprint 01A §6.A.3): presenting anything
   * other than the family's current secret revokes the whole family.
   */
  async refresh(
    refreshCookieValue: string | undefined,
    logContext: AuthLogContext,
  ): Promise<RefreshResult> {
    const startedAt = Date.now();
    const route = 'POST /auth/refresh';

    const parsed =
      this.refreshTokenService.parseCookieValue(refreshCookieValue);
    if (!parsed) {
      this.authEventLogger.log('auth.refresh.failed', {
        requestId: logContext.requestId,
        route,
        durationMs: Date.now() - startedAt,
        ipHash: logContext.ipHash,
        failureCategory: 'invalid_refresh_session',
      });
      throw new UnauthorizedException('Invalid refresh session');
    }
    const familyIdTruncated = parsed.familyId.slice(0, 8);

    const { outcome, secret, userId } = await this.refreshTokenService.rotate(
      parsed.familyId,
      parsed.secret,
    );

    if (outcome !== 'ok' || !secret) {
      if (outcome === 'reused') {
        // A materially different signal from a plain failure — kept as its
        // own named event (not folded into `invalid_refresh_session`) even
        // though the client-facing response is identical either way.
        this.authEventLogger.log('auth.refresh.reuse_detected', {
          requestId: logContext.requestId,
          route,
          durationMs: Date.now() - startedAt,
          userId: userId || undefined,
          ipHash: logContext.ipHash,
          familyIdTruncated,
        });
      } else {
        this.authEventLogger.log('auth.refresh.failed', {
          requestId: logContext.requestId,
          route,
          durationMs: Date.now() - startedAt,
          ipHash: logContext.ipHash,
          familyIdTruncated,
          failureCategory: 'invalid_refresh_session',
        });
      }
      throw new UnauthorizedException('Invalid refresh session');
    }

    const user = await this.prismaService.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true },
    });

    if (!user) {
      // User row no longer exists (e.g. deleted after the session was
      // issued) — revoke defensively rather than issuing a token for a
      // nonexistent account.
      await this.refreshTokenService.revoke(parsed.familyId);
      this.authEventLogger.log('auth.refresh.failed', {
        requestId: logContext.requestId,
        route,
        durationMs: Date.now() - startedAt,
        ipHash: logContext.ipHash,
        familyIdTruncated,
        failureCategory: 'invalid_refresh_session',
      });
      throw new UnauthorizedException('Invalid refresh session');
    }

    const { accessToken } = await this.signJwtToken(
      user.id,
      user.email,
      user.role,
    );
    const newRefreshCookieValue = this.refreshTokenService.encodeCookieValue(
      parsed.familyId,
      secret,
    );

    this.authEventLogger.log('auth.refresh.succeeded', {
      requestId: logContext.requestId,
      route,
      durationMs: Date.now() - startedAt,
      userId: user.id,
      role: user.role,
      ipHash: logContext.ipHash,
      familyIdTruncated,
    });

    return { accessToken, refreshCookieValue: newRefreshCookieValue };
  }

  /**
   * Logout - best-effort, idempotent session teardown (Sprint 01A §6.A.5).
   *
   * Deliberately does NOT require a currently-valid access token — a
   * missing, expired, or malformed token is not an error here, only a
   * skipped step. The refresh cookie (if present and well-formed) is
   * always used to revoke its session family. This method always
   * succeeds unless Redis itself is unreachable, in which case the
   * underlying services throw ServiceUnavailableException (503), which
   * is intentionally allowed to propagate rather than being swallowed
   * into a false "success" — session revocation must not fail silently.
   *
   * @param authorizationHeader - the raw `Authorization` header, if present
   * @param refreshCookieValue - the raw refresh cookie value, if present
   */
  async logout(
    authorizationHeader: string | undefined,
    refreshCookieValue: string | undefined,
    logContext: AuthLogContext,
  ): Promise<{ message: string }> {
    const startedAt = Date.now();
    const route = 'POST /auth/logout';
    const token = extractBearerToken(authorizationHeader);
    let userId: string | undefined;

    if (token) {
      try {
        // Signature is verified (so a forged/garbage token can't pollute
        // the blacklist with an attacker-chosen exp), but expiry is
        // deliberately NOT enforced — an already-expired-but-legitimate
        // token should still be blacklistable (addToBlacklist is a
        // harmless no-op for it anyway, since its remaining TTL is <= 0).
        const decoded = this.jwtService.verify<{ sub: string; exp: number }>(
          token,
          {
            secret: this.configService.get<string>('JWT_SECRET'),
            ignoreExpiration: true,
          },
        );

        userId = decoded?.sub;
        if (decoded?.exp) {
          await this.tokenBlacklistService.addToBlacklist(token, decoded.exp);
        }
      } catch (error) {
        // A Redis outage must not be swallowed here — only a token that
        // failed *verification* (bad signature, malformed) is a benign,
        // skippable case.
        if (error instanceof ServiceUnavailableException) throw error;
        this.logger.debug(
          'Logout: access token failed verification, skipping blacklist step',
        );
      }
    }

    const parsed =
      this.refreshTokenService.parseCookieValue(refreshCookieValue);
    let familyIdTruncated: string | undefined;
    if (parsed) {
      familyIdTruncated = parsed.familyId.slice(0, 8);
      await this.refreshTokenService.revoke(parsed.familyId);
    }

    this.authEventLogger.log('auth.logout.completed', {
      requestId: logContext.requestId,
      route,
      durationMs: Date.now() - startedAt,
      userId,
      ipHash: logContext.ipHash,
      familyIdTruncated,
    });

    return {
      message: 'Logout successful',
    };
  }
}
