import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailProvider, MailSendResult, RenderedEmail } from '../mail.types';

const RESEND_API_URL = 'https://api.resend.com/emails';

/**
 * The one concrete MailProvider adapter this sprint ships (ADR 005). Talks
 * to Resend's REST API via native `fetch` — no SDK dependency added,
 * consistent with this project's lean dependency footprint. Enforces its
 * own strict timeout (EMAIL_PROVIDER_TIMEOUT_MS) via AbortController, the
 * same pattern the frontend's `fetchWithTimeout` already uses.
 *
 * Every failure mode — a non-2xx response, a thrown network error, an
 * aborted request — is caught here and mapped to exactly one
 * `MailSendResult.failureCategory`. The raw `fetch` Response/error never
 * escapes this class: no module outside `src/mail/providers/` ever sees a
 * provider-specific detail (ADR 005's "no raw provider response escapes the
 * provider adapter" requirement).
 */
@Injectable()
export class ResendMailProvider implements MailProvider {
  private readonly logger = new Logger(ResendMailProvider.name);

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
      // resolves to a MailSendResult, per Sprint 02B's failure semantics.
      return {
        success: false,
        failureCategory: 'invalid_configuration',
        durationMs: Date.now() - startedAt,
      };
    }

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(RESEND_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: `${fromName} <${from}>`,
          to: [to],
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
        }),
        signal: controller.signal,
      });

      const durationMs = Date.now() - startedAt;

      if (!response.ok) {
        // Never logs/returns the raw response body — it may contain
        // recipient/request details echoed back by the provider.
        this.logger.warn(
          `Resend rejected a send attempt (status ${response.status})`,
        );
        return {
          success: false,
          failureCategory: 'provider_rejected',
          durationMs,
        };
      }

      const body = (await response.json().catch(() => ({}))) as {
        id?: string;
      };
      return { success: true, providerMessageId: body.id, durationMs };
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const isAbort = error instanceof Error && error.name === 'AbortError';
      // Never logs the raw error object — may embed request details.
      this.logger.warn(
        isAbort
          ? 'Resend send attempt timed out'
          : 'Resend send attempt failed to reach the network',
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
