import { Body, Controller, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import {
  GoogleAuthDTO,
  GoogleLinkDTO,
  LoginDTO,
  RegisterDTO,
  VerifyEmailDTO,
} from './dto';
import {
  DEFAULT_REFRESH_TOKEN_TTL_SECONDS,
  REFRESH_COOKIE_NAME,
} from './refresh-token.constants';
import { buildRefreshCookieOptions } from './utils/refresh-cookie.util';
import { AuthRateLimitGuard } from './guards/auth-rate-limit.guard';
import { JwtAuthGuard } from './guards';
import { RateLimits } from './decorators/rate-limits.decorator';
import { hashClientIp } from './utils/client-ip.util';
import type { RequestWithId } from './logging/request-id.middleware';
import type { AuthLogContext } from './logging/auth-event-logger.service';

// Sprint 01C — every method below that carries @RateLimits([...]) is
// evaluated by AuthRateLimitGuard (applied once at the class level; it's a
// no-op for any handler with no @RateLimits metadata, e.g. logout, which is
// deliberately not rate-limited — see docs/sprints/sprint-01C-security-hardening.md).
@UseGuards(AuthRateLimitGuard)
@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private config: ConfigService,
  ) {}

  private refreshCookieMaxAgeMs(): number {
    const ttlSeconds = Number(
      this.config.get<string>(
        'REFRESH_TOKEN_TTL_SECONDS',
        String(DEFAULT_REFRESH_TOKEN_TTL_SECONDS),
      ),
    );
    return ttlSeconds * 1000;
  }

  private setRefreshCookie(res: Response, value: string): void {
    res.cookie(
      REFRESH_COOKIE_NAME,
      value,
      buildRefreshCookieOptions(this.config, this.refreshCookieMaxAgeMs()),
    );
  }

  private clearRefreshCookie(res: Response): void {
    res.clearCookie(
      REFRESH_COOKIE_NAME,
      buildRefreshCookieOptions(this.config),
    );
  }

  private logContext(req: Request): AuthLogContext {
    return {
      requestId: (req as RequestWithId).requestId,
      ipHash: hashClientIp(req),
    };
  }

  //some requests from client
  @RateLimits([
    {
      kind: 'register-ip',
      maxConfigKey: 'AUTH_REGISTER_RATE_LIMIT_MAX',
      windowConfigKey: 'AUTH_REGISTER_RATE_LIMIT_WINDOW_SECONDS',
    },
    {
      kind: 'register-combo',
      maxConfigKey: 'AUTH_REGISTER_EMAIL_RATE_LIMIT_MAX',
      windowConfigKey: 'AUTH_REGISTER_RATE_LIMIT_WINDOW_SECONDS',
    },
  ])
  @Post('register') //register a new user
  //Gọi hàm register để xử lý
  //@Body là decorator nói với Nestjs là dùng để lấy dữ liệu từ request body
  //RegisterDTO để định nghĩa CTDL và áp luật validation
  //dto dữ liệu người dùng gửi lên request body
  async register(
    @Body() dto: RegisterDTO,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { refreshCookieValue, ...body } = await this.authService.register(
      dto,
      req.headers['user-agent'] ?? null,
      this.logContext(req),
    );
    this.setRefreshCookie(res, refreshCookieValue);
    return body;
  }
  //now controller calls service
  //POST:.../auth/login
  @RateLimits([
    {
      kind: 'login-combo',
      maxConfigKey: 'AUTH_LOGIN_RATE_LIMIT_MAX',
      windowConfigKey: 'AUTH_LOGIN_RATE_LIMIT_WINDOW_SECONDS',
    },
    {
      kind: 'login-ip',
      maxConfigKey: 'AUTH_LOGIN_IP_RATE_LIMIT_MAX',
      windowConfigKey: 'AUTH_LOGIN_RATE_LIMIT_WINDOW_SECONDS',
    },
  ])
  @Post('login')
  async login(
    @Body() dto: LoginDTO,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { refreshCookieValue, ...body } = await this.authService.login(
      dto,
      req.headers['user-agent'] ?? null,
      this.logContext(req),
    );
    this.setRefreshCookie(res, refreshCookieValue);
    return body;
  }

  // POST:.../auth/refresh
  // Rotates the refresh session (from the httpOnly cookie) and issues a
  // fresh access token. No auth guard here — the refresh cookie itself is
  // the credential being presented, not a bearer access token. The IP
  // backstop bucket applies to every request (not only a malformed/missing
  // cookie) — otherwise a fabricated, valid-looking-but-fake family id on
  // every request would land in its own empty bucket and never trip the
  // family-keyed limit (see docs/memory.md's Sprint 01C entry).
  @RateLimits([
    {
      kind: 'refresh-family',
      maxConfigKey: 'AUTH_REFRESH_RATE_LIMIT_MAX',
      windowConfigKey: 'AUTH_REFRESH_RATE_LIMIT_WINDOW_SECONDS',
    },
    {
      kind: 'refresh-ip',
      maxConfigKey: 'AUTH_REFRESH_IP_RATE_LIMIT_MAX',
      windowConfigKey: 'AUTH_REFRESH_RATE_LIMIT_WINDOW_SECONDS',
    },
  ])
  @Post('refresh')
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cookieValue = (
      req.cookies as Record<string, string | undefined> | undefined
    )?.[REFRESH_COOKIE_NAME];
    const { accessToken, refreshCookieValue } = await this.authService.refresh(
      cookieValue,
      this.logContext(req),
    );
    this.setRefreshCookie(res, refreshCookieValue);
    return { accessToken };
  }

  // POST:.../auth/google
  // Pre-verification limiting is IP-only — an unverified JWT email claim is
  // attacker-chosen, never used as a rate-limit key (see
  // docs/adr/004-google-auth.md). The IP bucket applies to every request.
  @RateLimits([
    {
      kind: 'google-ip',
      maxConfigKey: 'AUTH_GOOGLE_IP_RATE_LIMIT_MAX',
      windowConfigKey: 'AUTH_GOOGLE_RATE_LIMIT_WINDOW_SECONDS',
    },
  ])
  @Post('google')
  async google(
    @Body() dto: GoogleAuthDTO,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { refreshCookieValue, ...body } = await this.authService.google(
      dto,
      req.headers['user-agent'] ?? null,
      this.logContext(req),
    );
    this.setRefreshCookie(res, refreshCookieValue);
    return body;
  }

  // POST:.../auth/google/link
  // Same IP-only guard-level bucket as /auth/google; AuthService.linkGoogle
  // additionally checks its own backend-verified-identity bucket once the
  // credential is verified — this endpoint is a password-verification
  // oracle and is rate-limited at least as strictly as login.
  @RateLimits([
    {
      kind: 'google-link-ip',
      maxConfigKey: 'AUTH_GOOGLE_LINK_IP_RATE_LIMIT_MAX',
      windowConfigKey: 'AUTH_GOOGLE_LINK_RATE_LIMIT_WINDOW_SECONDS',
    },
  ])
  @Post('google/link')
  async googleLink(
    @Body() dto: GoogleLinkDTO,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { refreshCookieValue, ...body } = await this.authService.linkGoogle(
      dto,
      req.headers['user-agent'] ?? null,
      this.logContext(req),
    );
    this.setRefreshCookie(res, refreshCookieValue);
    return body;
  }

  // POST:.../auth/email-verification/resend
  // Authenticated — identity comes exclusively from req.user (the verified
  // JWT subject), never a client-supplied identifier. The class-level
  // AuthRateLimitGuard evaluates the IP-only bucket below; the user-scoped
  // bucket is checked inside AuthService.resendVerification() itself, since
  // req.user isn't populated until JwtAuthGuard runs, which is after this
  // class-level guard (see rate-limit-key.util.ts).
  @UseGuards(JwtAuthGuard)
  @RateLimits([
    {
      kind: 'email-verify-resend-ip',
      maxConfigKey: 'AUTH_EMAIL_VERIFY_RESEND_IP_RATE_LIMIT_MAX',
      windowConfigKey: 'AUTH_EMAIL_VERIFY_RESEND_RATE_LIMIT_WINDOW_SECONDS',
    },
  ])
  @Post('email-verification/resend')
  async resendVerification(@Req() req: Request & { user: { userId: string } }) {
    return this.authService.resendVerification(
      req.user.userId,
      this.logContext(req),
    );
  }

  // POST:.../auth/email-verification/verify
  // Public — the opaque token itself is the credential. The frontend email
  // link always lands on a frontend confirmation page that fires this POST
  // explicitly; there is no GET route a security scanner's link-prefetch
  // could use to silently consume a token (see
  // docs/sprints/sprint-02B-email-verification.md's Frontend Flow).
  @RateLimits([
    {
      kind: 'email-verify-ip',
      maxConfigKey: 'AUTH_EMAIL_VERIFY_IP_RATE_LIMIT_MAX',
      windowConfigKey: 'AUTH_EMAIL_VERIFY_RATE_LIMIT_WINDOW_SECONDS',
    },
    {
      kind: 'email-verify-token',
      maxConfigKey: 'AUTH_EMAIL_VERIFY_TOKEN_RATE_LIMIT_MAX',
      windowConfigKey: 'AUTH_EMAIL_VERIFY_RATE_LIMIT_WINDOW_SECONDS',
    },
  ])
  @Post('email-verification/verify')
  async verifyEmail(@Body() dto: VerifyEmailDTO, @Req() req: Request) {
    return this.authService.verifyEmail(dto, this.logContext(req));
  }

  //POST:.../auth/logout
  // Deliberately guard-free (see auth.service.ts's logout doc comment):
  // logout must succeed even with a missing/expired/malformed access
  // token, so it cannot sit behind JwtAuthGuard, which would reject the
  // request before the handler ever runs.
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const cookieValue = (
      req.cookies as Record<string, string | undefined> | undefined
    )?.[REFRESH_COOKIE_NAME];
    const result = await this.authService.logout(
      req.headers.authorization,
      cookieValue,
      this.logContext(req),
    );
    this.clearRefreshCookie(res);
    return result;
  }
}
