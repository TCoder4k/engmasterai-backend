import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import { GoogleTokenInvalidError } from './google-token-invalid.error';
import { normalizeEmail } from '../utils/email.util';

export interface VerifiedGoogleIdentity {
  sub: string;
  email: string;
  name: string;
  picture?: string;
}

/**
 * The sole trust boundary between an untrusted client-supplied Google ID
 * token and anything AuthService acts on. Every field returned here comes
 * exclusively from the verified JWT payload — nothing the caller supplies
 * directly (a raw `email`/`name`/`sub` in the request body, which this
 * service never even accepts) is ever trusted.
 */
@Injectable()
export class GoogleTokenVerifierService {
  // One client per process — verifyIdToken() internally fetches and caches
  // Google's published JWKS, so reusing the instance avoids re-fetching keys
  // on every call.
  private client: OAuth2Client | null = null;

  constructor(private readonly config: ConfigService) {}

  async verify(idToken: string): Promise<VerifiedGoogleIdentity> {
    if (this.config.get<boolean>('GOOGLE_AUTH_ENABLED') !== true) {
      throw new ServiceUnavailableException('Google sign-in is not available');
    }

    // Guaranteed present when the flag is true — enforced at boot by the
    // Joi schema (env.validation.ts), so this is a read, not a runtime
    // existence check.
    const clientId = this.config.get<string>('GOOGLE_CLIENT_ID') as string;
    if (!this.client) this.client = new OAuth2Client(clientId);

    let payload: import('google-auth-library').TokenPayload | undefined;
    try {
      const ticket = await this.client.verifyIdToken({
        idToken,
        audience: clientId,
      });
      payload = ticket.getPayload();
    } catch {
      // Never surface the library's own error text (may include token
      // fragments/internal detail) — a single generic outcome only.
      throw new GoogleTokenInvalidError();
    }

    if (!payload?.sub || !payload.email || !payload.email_verified) {
      throw new GoogleTokenInvalidError();
    }
    // verifyIdToken() already enforces this internally; reasserted
    // defensively for both accepted issuer string forms.
    if (
      payload.iss !== 'accounts.google.com' &&
      payload.iss !== 'https://accounts.google.com'
    ) {
      throw new GoogleTokenInvalidError();
    }

    return {
      sub: payload.sub,
      // Sprint 02B: routed through the same centralized normalizeEmail()
      // every other lookup/write path uses, rather than a second,
      // independent inline implementation of the same rule.
      email: normalizeEmail(payload.email),
      name: payload.name ?? payload.email,
      picture: payload.picture,
    };
  }
}
