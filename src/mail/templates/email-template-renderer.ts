import { Injectable } from '@nestjs/common';
import {
  EmailTemplateId,
  EmailVerificationTemplateVariables,
  RenderedEmail,
} from '../mail.types';
import { renderEmailVerificationTemplate } from './email-verification.template';

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
 * Only one template exists this sprint (`'email-verification'`), so this
 * takes a single concrete variables type rather than a generic mapped type —
 * adding the next template (Sprint 02C's `'password-reset'`) is expected to
 * introduce a small overloaded/union signature at that point, not a
 * speculative generic built now for a template that doesn't exist yet.
 */
@Injectable()
export class EmailTemplateRenderer {
  render(
    template: EmailTemplateId,
    variables: EmailVerificationTemplateVariables,
  ): RenderedEmail {
    switch (template) {
      case 'email-verification':
        return renderEmailVerificationTemplate(variables);
      default: {
        const exhaustiveCheck: never = template;
        throw new Error(`Unknown email template: ${String(exhaustiveCheck)}`);
      }
    }
  }
}
