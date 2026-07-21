import type { CookieOptions } from 'express';
import { ConfigService } from '@nestjs/config';
import { REFRESH_COOKIE_PATH } from '../refresh-token.constants';

// Shared cookie attributes for setting AND clearing the refresh cookie — an
// Express `clearCookie` call only actually removes the cookie in the browser
// if its options (path/sameSite/secure) match what was used to set it.
export const buildRefreshCookieOptions = (
  config: ConfigService,
  maxAgeMs?: number,
): CookieOptions => ({
  httpOnly: true,
  secure: config.get<string>('NODE_ENV') === 'production',
  sameSite: 'lax',
  path: REFRESH_COOKIE_PATH,
  ...(maxAgeMs !== undefined ? { maxAge: maxAgeMs } : {}),
});
