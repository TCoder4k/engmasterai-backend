import {
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDTO, RegisterDTO } from './dto';
import * as argon from 'argon2';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import { TokenBlacklistService } from './token-blacklist.service';
import { RefreshTokenService } from './refresh-token.service';
import { extractBearerToken } from './utils/extract-bearer-token';
import {
  AuthEventLogger,
  AuthLogContext,
} from './logging/auth-event-logger.service';
import { emailHashPrefix } from './rate-limit/rate-limit-key.util';

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

      // Generate access token
      const { accessToken } = await this.signJwtToken(
        user.id,
        user.email,
        user.role,
      );
      const refreshCookieValue = await this.issueRefreshCookieValue(
        user.id,
        userAgent,
      );

      this.authEventLogger.log('auth.register.succeeded', {
        requestId: logContext.requestId,
        route,
        durationMs: Date.now() - startedAt,
        userId: user.id,
        role: user.role,
        ipHash: logContext.ipHash,
      });

      return {
        message: 'Registration successful',
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        },
        accessToken,
        refreshCookieValue,
      };
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

    // Verify password
    const passwordMatched = await argon.verify(user.password, dto.password);

    if (!passwordMatched) {
      logFailure();
      throw new ForbiddenException('Invalid credentials');
    }

    // Generate access token + a new refresh session
    const { accessToken } = await this.signJwtToken(
      user.id,
      user.email,
      user.role,
    );
    const refreshCookieValue = await this.issueRefreshCookieValue(
      user.id,
      userAgent,
    );

    this.authEventLogger.log('auth.login.succeeded', {
      requestId: logContext.requestId,
      route,
      durationMs: Date.now() - startedAt,
      userId: user.id,
      role: user.role,
      ipHash: logContext.ipHash,
    });

    return {
      message: 'Login successful',
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
