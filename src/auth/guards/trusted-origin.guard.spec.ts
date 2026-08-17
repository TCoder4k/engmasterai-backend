import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TrustedOriginGuard } from './trusted-origin.guard';

const TRUSTED = 'https://app.example.com';

const buildContext = (origin: string | undefined): ExecutionContext => {
  const request = { headers: { origin } };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
};

const guardWithAllowlist = (corsAllowedOrigins?: string): TrustedOriginGuard =>
  new TrustedOriginGuard(
    new ConfigService({ CORS_ALLOWED_ORIGINS: corsAllowedOrigins }),
  );

// Fail-closed by design: only an exact match against a non-empty allowlist
// passes. CORS is not CSRF protection — see the guard's own doc comment —
// so every other branch (missing, forged, "null", or no allowlist at all)
// must reject, not just the obviously-hostile ones.
describe('TrustedOriginGuard', () => {
  it('allows a request whose Origin exactly matches the trusted allowlist', () => {
    const guard = guardWithAllowlist(TRUSTED);
    expect(guard.canActivate(buildContext(TRUSTED))).toBe(true);
  });

  it('matches case-insensitively, same as CORS_ALLOWED_ORIGINS parsing elsewhere', () => {
    const guard = guardWithAllowlist(TRUSTED);
    expect(guard.canActivate(buildContext(TRUSTED.toUpperCase()))).toBe(true);
  });

  it('rejects (403) an Origin not on the allowlist', () => {
    const guard = guardWithAllowlist(TRUSTED);
    expect(() =>
      guard.canActivate(buildContext('https://evil.example.com')),
    ).toThrow(ForbiddenException);
  });

  it('rejects (403) a literal "null" Origin (sandboxed iframe / file:// / some redirects)', () => {
    const guard = guardWithAllowlist(TRUSTED);
    expect(() => guard.canActivate(buildContext('null'))).toThrow(
      ForbiddenException,
    );
  });

  it('rejects (403) a request with no Origin header at all', () => {
    const guard = guardWithAllowlist(TRUSTED);
    expect(() => guard.canActivate(buildContext(undefined))).toThrow(
      ForbiddenException,
    );
  });

  it('rejects (403) every request when the trusted-origin allowlist is empty', () => {
    const guard = guardWithAllowlist(undefined);
    expect(() => guard.canActivate(buildContext(TRUSTED))).toThrow(
      ForbiddenException,
    );
    expect(() => guard.canActivate(buildContext(undefined))).toThrow(
      ForbiddenException,
    );
  });

  it('rejects (403) rather than throwing an unhandled error when CORS_ALLOWED_ORIGINS is malformed', () => {
    // Should never happen past app boot (Joi validates this), but the guard
    // must still fail closed, not crash with a raw parse error, if it did.
    const guard = guardWithAllowlist('not a url at all');
    expect(() => guard.canActivate(buildContext(TRUSTED))).toThrow(
      ForbiddenException,
    );
  });
});
