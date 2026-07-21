import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Sprint 01C's ten-event taxonomy (docs/sprints/sprint-01C-security-hardening.md).
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
  | 'auth.redis.unavailable';

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
