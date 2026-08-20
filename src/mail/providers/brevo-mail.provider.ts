import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailProvider, MailSendResult, RenderedEmail } from '../mail.types';

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

/**
 * Third `MailProvider` adapter (ADR 005 anticipated this: "migrating to
 * [another provider] later is a new adapter class, not an
 * AuthService/TransactionalMailService change"). Talks to Brevo's
 * transactional email v3 REST API via native `fetch` — no SDK dependency,
 * same convention as ResendMailProvider/SendGridMailProvider. Selected
 * instead of them when EMAIL_PROVIDER=brevo (see mail.module.ts).
 *
 * Brevo authenticates this endpoint with an `api-key` header carrying a v3
 * **API key** (dashboard prefix `xkeysib-`) — NOT the separate SMTP key
 * (prefix `xsmtpsib-`) used only for SMTP relay login. The two are issued
 * from different tabs of the same settings page and are not interchangeable;
 * sending the SMTP key here fails auth (`provider_rejected`).
 *
 * Every failure mode is caught here and mapped to exactly one
 * `MailSendResult.failureCategory` — the raw `fetch` Response/error never
 * escapes this class (ADR 005's "no raw provider response escapes the
 * provider adapter" requirement).
 */
@Injectable()
export class BrevoMailProvider implements MailProvider {
  private readonly logger = new Logger(BrevoMailProvider.name);

  constructor(private readonly config: ConfigService) {}

  async send(rendered: RenderedEmail, to: string): Promise<MailSendResult> {
    const startedAt = Date.now();
    const apiKey = this.config.get<string>('EMAIL_PROVIDER_API_KEY');
    const from = this.config.get<string>('EMAIL_FROM');
    const fromName = this.config.get<string>('EMAIL_FROM_NAME');
    const timeoutMs = this.config.get<number>(
      'EMAIL_PROVIDER_TIMEOUT_MS',
    ) as number;

    if (!apiKey || !from) {
      // Guaranteed present at boot when EMAIL_ENABLED=true (Joi validation) —
      // reaching this branch means runtime config drifted from what was
      // validated at startup. Never thrown — every expected failure mode
      // resolves to a MailSendResult, per ADR 005's failure semantics.
      return {
        success: false,
        failureCategory: 'invalid_configuration',
        durationMs: Date.now() - startedAt,
      };
    }

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(BREVO_API_URL, {
        method: 'POST',
        headers: {
          'api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          sender: { email: from, name: fromName },
          to: [{ email: to }],
          subject: rendered.subject,
          htmlContent: rendered.html,
          textContent: rendered.text,
        }),
        signal: controller.signal,
      });

      const durationMs = Date.now() - startedAt;

      if (!response.ok) {
        // Never logs/returns the raw response body — it may contain
        // recipient/request details echoed back by the provider.
        this.logger.warn(
          `Brevo rejected a send attempt (status ${response.status})`,
        );
        return {
          success: false,
          failureCategory: 'provider_rejected',
          durationMs,
        };
      }

      const body = (await response.json().catch(() => ({}))) as {
        messageId?: string;
      };
      return { success: true, providerMessageId: body.messageId, durationMs };
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const isAbort = error instanceof Error && error.name === 'AbortError';
      // Never logs the raw error object — may embed request details.
      this.logger.warn(
        isAbort
          ? 'Brevo send attempt timed out'
          : 'Brevo send attempt failed to reach the network',
      );
      return {
        success: false,
        failureCategory: isAbort ? 'timeout' : 'network_error',
        durationMs,
      };
    } finally {
      clearTimeout(timeoutHandle);
    }
  }
}
