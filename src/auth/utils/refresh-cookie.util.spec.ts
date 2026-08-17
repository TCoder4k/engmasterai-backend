import { ConfigService } from '@nestjs/config';
import { buildRefreshCookieOptions } from './refresh-cookie.util';
import { REFRESH_COOKIE_PATH } from '../refresh-token.constants';

const configFor = (nodeEnv: string): ConfigService =>
  new ConfigService({ NODE_ENV: nodeEnv });

describe('buildRefreshCookieOptions', () => {
  describe('development / test (same-site http://localhost — unchanged by Phase 3)', () => {
    it.each(['development', 'test'])(
      'is httpOnly, non-secure, SameSite=Lax for NODE_ENV=%s',
      (nodeEnv) => {
        const options = buildRefreshCookieOptions(configFor(nodeEnv));
        expect(options.httpOnly).toBe(true);
        expect(options.secure).toBe(false);
        expect(options.sameSite).toBe('lax');
      },
    );
  });

  describe('production (cross-site Vercel/Railway — Phase 3 change)', () => {
    it('is httpOnly, secure, SameSite=None', () => {
      const options = buildRefreshCookieOptions(configFor('production'));
      expect(options.httpOnly).toBe(true);
      expect(options.secure).toBe(true);
      expect(options.sameSite).toBe('none');
    });
  });

  it('always scopes the cookie to REFRESH_COOKIE_PATH ("/auth")', () => {
    expect(buildRefreshCookieOptions(configFor('production')).path).toBe(
      REFRESH_COOKIE_PATH,
    );
    expect(buildRefreshCookieOptions(configFor('development')).path).toBe(
      REFRESH_COOKIE_PATH,
    );
  });

  it('never sets a Domain attribute (host-only cookie — Vercel and Railway are unrelated domains, not subdomains of one root)', () => {
    const options = buildRefreshCookieOptions(configFor('production'));
    expect(options).not.toHaveProperty('domain');
  });

  it('includes maxAge when a value is passed (setting the cookie on login/refresh)', () => {
    const options = buildRefreshCookieOptions(configFor('production'), 12345);
    expect(options.maxAge).toBe(12345);
  });

  it('omits maxAge when no value is passed (clearing the cookie on logout)', () => {
    const options = buildRefreshCookieOptions(configFor('production'));
    expect(options).not.toHaveProperty('maxAge');
  });
});
