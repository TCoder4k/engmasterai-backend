import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { parseAllowedOrigins } from '../../config/cors-origins.util';

/**
 * CSRF defense for the two endpoints that authenticate by cookie alone
 * (POST /auth/refresh, POST /auth/logout — no Authorization header
 * required). CORS does not protect these: a browser still SENDS a
 * cross-site request with cookies attached even when CORS would later
 * block the attacker page from reading the response, so a forged
 * `fetch(..., {credentials:'include'})` from any origin can still rotate
 * or clear a victim's refresh session. This guard is deliberately named
 * "trusted", not "same" — the real frontend and backend are intentionally
 * cross-origin (separate Vercel/Railway domains), so "same-origin" is
 * never the expected case here.
 *
 * Fails closed in every branch except an exact allowlist match — reuses
 * CORS_ALLOWED_ORIGINS (parseAllowedOrigins), the same list main.ts's CORS
 * setup trusts, so there is exactly one definition of "trusted origin" to
 * keep in sync, never two that could drift apart.
 */
@Injectable()
export class TrustedOriginGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const origin = request.headers.origin;

    let allowedOrigins: string[];
    try {
      allowedOrigins = parseAllowedOrigins(
        this.config.get<string>('CORS_ALLOWED_ORIGINS'),
      );
    } catch {
      // A malformed CORS_ALLOWED_ORIGINS would already fail app boot (Joi) —
      // this is only a defensive backstop, matching the fail-closed
      // contract: an unparseable allowlist trusts nothing.
      allowedOrigins = [];
    }

    // Every branch below falls through to the same rejection: an empty
    // allowlist, a missing Origin header, a literal "null" Origin (sent by
    // sandboxed iframes / file:// / some redirect flows), and an Origin
    // that simply isn't allowlisted. Only an exact, case-insensitive match
    // against a non-empty allowlist passes.
    if (
      allowedOrigins.length === 0 ||
      !origin ||
      !allowedOrigins.includes(origin.toLowerCase())
    ) {
      throw new ForbiddenException('Origin not trusted');
    }

    return true;
  }
}
