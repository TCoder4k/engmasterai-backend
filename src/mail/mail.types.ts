// Shared types for the transactional-mail subsystem (Sprint 02B, ADR 005).
// No module outside src/mail/ should need to import anything except these
// types plus TransactionalMailService itself.

/**
 * The only shape a mail send ever resolves to — no booleans, no raw
 * provider response object ever crosses this boundary. `failureCategory` is
 * a closed union so every caller (AuthService, AuthEventLogger) can branch
 * on it exhaustively without ever seeing provider-specific detail.
 */
export type MailSendResult =
  | {
      success: true;
      /** Resend's own opaque delivery id — not logged this sprint (see ADR 005). */
      providerMessageId?: string;
      durationMs: number;
    }
  | {
      success: false;
      failureCategory:
        | 'disabled' // EMAIL_ENABLED=false — NullMailProvider short-circuit
        | 'timeout' // provider call exceeded EMAIL_PROVIDER_TIMEOUT_MS
        | 'provider_rejected' // provider returned a non-success HTTP status
        | 'network_error' // the request never reached the provider
        | 'invalid_configuration' // misconfigured at runtime despite Joi validation at boot
        | 'unknown'; // any other error, caught and categorized, never rethrown raw
      durationMs: number;
    };

/** Output of EmailTemplateRenderer — the only shape a MailProvider ever receives. */
export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

// Closed union of template identifiers. This sprint implements exactly one;
// designed to grow (password-reset, welcome, security-alert, ...) without
// changing TransactionalMailService's or MailProvider's contracts.
export type EmailTemplateId = 'email-verification';

export interface EmailVerificationTemplateVariables {
  name: string;
  verifyUrl: string;
  expiresInMinutes: number;
}

/**
 * Delivery-only boundary. Implementations receive already-rendered content
 * and perform delivery only — they never see a template identifier or raw
 * variables, and never perform their own rendering (ADR 005).
 */
export interface MailProvider {
  send(rendered: RenderedEmail, to: string): Promise<MailSendResult>;
}

export const MAIL_PROVIDER = Symbol('MAIL_PROVIDER');
