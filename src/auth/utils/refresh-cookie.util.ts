import type { CookieOptions } from 'express';
import { ConfigService } from '@nestjs/config';
import { REFRESH_COOKIE_PATH } from '../refresh-token.constants';

// Shared cookie attributes for setting AND clearing the refresh cookie — an
// Express `clearCookie` call only actually removes the cookie in the browser
// if its options (path/sameSite/secure) match what was used to set it.
//
// sameSite is 'none' in production because the real deployment is
// cross-site by design (separate Vercel/Railway domains) — 'lax' would
// silently stop the browser from ever sending this cookie back on
// POST /auth/refresh. 'none' requires `Secure` (browsers reject
// SameSite=None without it), which is exactly what `secure` already
// evaluates to in production. Dev/test stay 'lax' + non-secure, matching
// today's same-site http://localhost behavior unchanged. SameSite=None
// alone is not a CSRF defense — see guards/trusted-origin.guard.ts, applied
// to every endpoint that authenticates by this cookie alone.
export const buildRefreshCookieOptions = (
  config: ConfigService,
  maxAgeMs?: number,
): CookieOptions => {
  const isProduction = config.get<string>('NODE_ENV') === 'production';
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    path: REFRESH_COOKIE_PATH,
    ...(maxAgeMs !== undefined ? { maxAge: maxAgeMs } : {}),
  };
};
