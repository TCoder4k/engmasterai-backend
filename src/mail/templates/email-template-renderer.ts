import { Injectable } from '@nestjs/common';
import {
  EmailTemplateId,
  EmailVerificationTemplateVariables,
  GoogleOnlyPasswordResetNoticeTemplateVariables,
  PasswordResetSuccessTemplateVariables,
  PasswordResetTemplateVariables,
  RenderedEmail,
} from '../mail.types';
import { renderEmailVerificationTemplate } from './email-verification.template';
import { renderPasswordResetTemplate } from './password-reset.template';
import { renderGoogleOnlyPasswordResetNoticeTemplate } from './google-only-password-reset-notice.template';
import { renderPasswordResetSuccessTemplate } from './password-reset-success.template';

type AnyTemplateVariables =
  | EmailVerificationTemplateVariables
  | PasswordResetTemplateVariables
  | GoogleOnlyPasswordResetNoticeTemplateVariables
  | PasswordResetSuccessTemplateVariables;

// Escapes the five HTML-significant characters. Applied to every
// user-controlled value (currently: `name`) before it is interpolated into
// an HTML body — this is the concrete boundary that closes the injection
// surface a template renderer otherwise opens (Sprint 02B, ADR 005).
export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/**
 * Pure rendering stage between TransactionalMailService and MailProvider
 * (ADR 005): typed template id + typed variables in, {subject, html, text}
 * out. No provider SDK calls, no network calls — fully unit-testable
 * without mocking anything. Hand-written, not a templating framework — this
 * project has no existing templating dependency and one template does not
 * justify one (see docs/sprints/sprint-02B-email-verification.md).
 *
 * Sprint 02B shipped one template (`'email-verification'`). Sprint 02C adds
 * three more (password-reset, google-only-password-reset-notice,
 * password-reset-success) — exactly the overloaded-signature growth this
 * class's original doc comment anticipated: each template id is paired with
 * its own concrete variables type via a call-signature overload, so callers
 * get full type-checking per template while the single implementation
 * signature below narrows via the `switch`.
 */
@Injectable()
export class EmailTemplateRenderer {
  render(
    template: 'email-verification',
    variables: EmailVerificationTemplateVariables,
  ): RenderedEmail;
  render(
    template: 'password-reset',
    variables: PasswordResetTemplateVariables,
  ): RenderedEmail;
  render(
    template: 'google-only-password-reset-notice',
    variables: GoogleOnlyPasswordResetNoticeTemplateVariables,
  ): RenderedEmail;
  render(
    template: 'password-reset-success',
    variables: PasswordResetSuccessTemplateVariables,
  ): RenderedEmail;
  render(
    template: EmailTemplateId,
    variables: AnyTemplateVariables,
  ): RenderedEmail {
    switch (template) {
      case 'email-verification':
        return renderEmailVerificationTemplate(
          variables as EmailVerificationTemplateVariables,
        );
      case 'password-reset':
        return renderPasswordResetTemplate(
          variables as PasswordResetTemplateVariables,
        );
      case 'google-only-password-reset-notice':
        return renderGoogleOnlyPasswordResetNoticeTemplate(
          variables as GoogleOnlyPasswordResetNoticeTemplateVariables,
        );
      case 'password-reset-success':
        return renderPasswordResetSuccessTemplate(
          variables as PasswordResetSuccessTemplateVariables,
        );
      default: {
        const exhaustiveCheck: never = template;
        throw new Error(`Unknown email template: ${String(exhaustiveCheck)}`);
      }
    }
  }
}
