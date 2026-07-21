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
import { UserRole } from '@prisma/client';
import { TokenBlacklistService } from './token-blacklist.service';
import { RefreshTokenService } from './refresh-token.service';
import { extractBearerToken } from './utils/extract-bearer-token';

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
    private tokenBlacklistService: TokenBlacklistService,
    private refreshTokenService: RefreshTokenService,
  ) {}

  async register(
    dto: RegisterDTO,
    userAgent: string | null,
  ): Promise<AuthResult> {
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

      this.logger.log(`Registration succeeded (userId=${user.id})`);

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
      if (error.code === 'P2002') {
        this.logger.warn(`Registration failed: email already exists`);
        throw new ForbiddenException('Email already exists');
      }
      this.logger.error('Registration failed', error as Error);
      throw new ForbiddenException('Registration failed');
    }
  }
  async login(dto: LoginDTO, userAgent: string | null): Promise<AuthResult> {
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
      this.logger.warn('Login failed: invalid credentials');
      throw new ForbiddenException('Invalid credentials');
    }

    // Verify role matches
    if (user.role !== dto.role) {
      this.logger.warn(`Login failed: role mismatch (userId=${user.id})`);
      throw new ForbiddenException('Invalid credentials or unauthorized role');
    }

    // Verify password
    const passwordMatched = await argon.verify(user.password, dto.password);

    if (!passwordMatched) {
      this.logger.warn(`Login failed: invalid credentials (userId=${user.id})`);
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

    this.logger.log(`Login succeeded (userId=${user.id})`);

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
      secret: process.env.JWT_SECRET,
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
  ): Promise<RefreshResult> {
    const parsed =
      this.refreshTokenService.parseCookieValue(refreshCookieValue);
    if (!parsed) {
      throw new UnauthorizedException('Invalid refresh session');
    }

    const { outcome, secret, userId } = await this.refreshTokenService.rotate(
      parsed.familyId,
      parsed.secret,
    );

    if (outcome !== 'ok' || !secret) {
      if (outcome === 'reused') {
        this.logger.warn(
          `Refresh rejected: reuse detected (userId=${userId || 'unknown'})`,
        );
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

    this.logger.log(`Refresh succeeded (userId=${user.id})`);

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
  ): Promise<{ message: string }> {
    const token = extractBearerToken(authorizationHeader);

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
            secret: process.env.JWT_SECRET,
            ignoreExpiration: true,
          },
        );

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
    if (parsed) {
      await this.refreshTokenService.revoke(parsed.familyId);
    }

    this.logger.log('Logout processed');

    return {
      message: 'Logout successful',
    };
  }
}
