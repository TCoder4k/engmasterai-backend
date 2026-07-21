import { Body, Controller, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { LoginDTO, RegisterDTO } from './dto';
import {
  DEFAULT_REFRESH_TOKEN_TTL_SECONDS,
  REFRESH_COOKIE_NAME,
} from './refresh-token.constants';
import { buildRefreshCookieOptions } from './utils/refresh-cookie.util';

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

  //some requests from client
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
    );
    this.setRefreshCookie(res, refreshCookieValue);
    return body;
  }
  //now controller calls service
  //POST:.../auth/login
  @Post('login')
  async login(
    @Body() dto: LoginDTO,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { refreshCookieValue, ...body } = await this.authService.login(
      dto,
      req.headers['user-agent'] ?? null,
    );
    this.setRefreshCookie(res, refreshCookieValue);
    return body;
  }

  // POST:.../auth/refresh
  // Rotates the refresh session (from the httpOnly cookie) and issues a
  // fresh access token. No guard here — the refresh cookie itself is the
  // credential being presented, not a bearer access token.
  @Post('refresh')
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cookieValue = (
      req.cookies as Record<string, string | undefined> | undefined
    )?.[REFRESH_COOKIE_NAME];
    const { accessToken, refreshCookieValue } =
      await this.authService.refresh(cookieValue);
    this.setRefreshCookie(res, refreshCookieValue);
    return { accessToken };
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
    );
    this.clearRefreshCookie(res);
    return result;
  }
}
