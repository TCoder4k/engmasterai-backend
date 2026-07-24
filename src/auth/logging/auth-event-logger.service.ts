import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Sprint 01C's ten-event taxonomy (docs/sprints/sprint-01C-security-hardening.md)
// plus Sprint 02A's six Google-auth events, Sprint 02B's seven
// email-verification events, and Sprint 02C's twelve password-reset events
// (docs/sprints/sprint-02C-password-recovery.md).
export type AuthEventName =
  | 'auth.login.succeeded'
  | 'auth.login.failed'
  | 'auth.register.succeeded'
  | 'auth.register.failed'
  | 'auth.refresh.succeeded'
  | 'auth.refresh.failed'
  | 'auth.refresh.reuse_detected'
  | 'auth.logout.completed'
  | 'auth.rate_limit.exceeded'
  | 'auth.redis.unavailable'
  | 'auth.google.succeeded'
  | 'auth.google.failed'
  | 'auth.google.account_created'
  | 'auth.google.link_required'
  | 'auth.google.identity_linked'
  | 'auth.google.link_failed'
  | 'auth.email_verification.requested'
  | 'auth.email_verification.sent'
  | 'auth.email_verification.failed'
  | 'auth.email_verification.completed'
  | 'auth.email_verification.invalid'
  | 'auth.email_verification.expired'
  | 'auth.email_verification.already_verified'
  | 'auth.password_reset.requested'
  | 'auth.password_reset.completed'
  | 'auth.password_reset.failed'
  | 'auth.password_reset.invalid'
  | 'auth.password_reset.expired'
  | 'auth.password_reset.sessions_revoked'
  | 'auth.password_reset.reuse_rejected'
  // Alert-worthy: Redis was unavailable at the post-commit revocation step —
  // the password changed but old sessions may still be live (ADR 006).
  | 'auth.password_reset.revocation_failed'
  | 'auth.password_reset.notice_sent'
  | 'auth.password_reset.notice_failed'
  | 'auth.password_reset.google_only_notice_sent'
  | 'auth.password_reset.google_only_notice_failed';

// What the controller derives once per request and threads through to
// AuthService — never re-derived deeper in the call stack.
export interface AuthLogContext {
  requestId: string;
  ipHash: string;
}

// The full allowlist across every event — not every event uses every
// field. Never widened with an index signature: any new field must be
// added here deliberately, which is the whole point of an allowlist.
export interface AuthEventFields {
  requestId?: string;
  route?: string;
  statusCode?: number;
  durationMs?: number;
  userId?: string;
  role?: string;
  emailHash?: string;
  ipHash?: string;
  familyIdTruncated?: string;
  failureCategory?: string;
  // Sprint 02A: 'google' — forward-looking, lets ops query "all social
  // logins" without event-name prefix matching once more providers exist.
  provider?: string;
  // sha256Hex(sub).slice(0,16), same truncation convention as
  // emailHashPrefix — used only when no userId exists yet (e.g. a failed
  // verification before any user lookup), to correlate repeated failures
  // from one Google account without ever logging the raw `sub`.
  providerSubjectHash?: string;
  // Sprint 02C, Revision 3: sha256Hex(User-Agent header).slice(0,16), same
  // truncation convention as the fields above — populated on
  // auth.password_reset.completed for audit purposes. The raw header is
  // never logged. country/device-family were considered and deliberately
  // deferred (no GeoIP/UA-parsing dependency exists in this codebase).
  userAgentHash?: string;
}

/**
 * Thin wrapper around Nest's built-in `Logger` producing single-line JSON
 * payloads built from an explicit field allowlist (Sprint 01C, §8/§9) —
 * never `JSON.stringify(req)`/`JSON.stringify(user)`/a spread DTO. Forbidden
 * values (passwords, tokens, cookies, raw emails/IPs, Authorization
 * headers) have no code path into this class by construction: callers only
 * ever pass the allowlisted fields above, already hashed/truncated where
 * required.
 *
 * Every call is wrapped in try/catch — a serialization or logging failure
 * here must never propagate into (or delay) the auth operation that called
 * it, and the fallback message deliberately carries no payload, so a
 * failure can't leak whatever caused it.
 */
@Injectable()
export class AuthEventLogger {
  private readonly logger = new Logger('AuthEvent');

  constructor(private readonly config: ConfigService) {}

  log(event: AuthEventName, fields: AuthEventFields = {}): void {
    try {
      const payload = {
        event,
        timestamp: new Date().toISOString(),
        environment: this.config.get<string>('NODE_ENV'),
        ...fields,
      };
      this.logger.log(JSON.stringify(payload));
    } catch {
      this.logger.warn('structured auth logging failed');
    }
  }
}
