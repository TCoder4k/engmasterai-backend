import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailTemplateRenderer } from './templates/email-template-renderer';
import { MAIL_PROVIDER } from './mail.types';
import type { MailProvider, MailSendResult } from './mail.types';

/**
 * The one boundary AuthService (and any future domain service) talks to —
 * never a MailProvider or the provider SDK directly (ADR 005). Selects a
 * template, asks EmailTemplateRenderer to render it, hands the rendered
 * content to whichever MailProvider was wired in (Resend, or NullProvider
 * when EMAIL_ENABLED=false), and always resolves to a MailSendResult —
 * never throws for an expected failure mode, so every call site can safely
 * `await` it without a try/catch around anything but genuine programmer
 * errors.
 */
@Injectable()
export class TransactionalMailService {
  constructor(
    @Inject(MAIL_PROVIDER) private readonly provider: MailProvider,
    private readonly renderer: EmailTemplateRenderer,
    private readonly config: ConfigService,
  ) {}

  async sendVerificationEmail(
    to: string,
    variables: { name: string; rawToken: string },
  ): Promise<MailSendResult> {
    const frontendAppUrl = this.config.get<string>(
      'FRONTEND_APP_URL',
    ) as string;
    const expiresInMinutes = this.config.get<number>(
      'EMAIL_VERIFICATION_TOKEN_TTL_MINUTES',
    ) as number;

    const verifyUrl = `${frontendAppUrl}/verify-email?token=${encodeURIComponent(variables.rawToken)}`;

    const rendered = this.renderer.render('email-verification', {
      name: variables.name,
      verifyUrl,
      expiresInMinutes,
    });

    return this.provider.send(rendered, to);
  }

  async sendPasswordResetEmail(
    to: string,
    variables: { name: string; rawToken: string },
  ): Promise<MailSendResult> {
    const frontendAppUrl = this.config.get<string>(
      'FRONTEND_APP_URL',
    ) as string;
    const expiresInMinutes = this.config.get<number>(
      'PASSWORD_RESET_TOKEN_TTL_MINUTES',
    ) as number;

    const resetUrl = `${frontendAppUrl}/reset-password?token=${encodeURIComponent(variables.rawToken)}`;

    const rendered = this.renderer.render('password-reset', {
      name: variables.name,
      resetUrl,
      expiresInMinutes,
    });

    return this.provider.send(rendered, to);
  }

  /** See "Google-Only Account Policy" — no link, no token, purely informational. */
  async sendGoogleOnlyPasswordResetNotice(
    to: string,
    variables: { name: string },
  ): Promise<MailSendResult> {
    const rendered = this.renderer.render('google-only-password-reset-notice', {
      name: variables.name,
    });

    return this.provider.send(rendered, to);
  }

  /** See "Security Notice Email" — best-effort, sent after a successful reset. */
  async sendPasswordResetSuccessNotice(
    to: string,
    variables: { name: string },
  ): Promise<MailSendResult> {
    const rendered = this.renderer.render('password-reset-success', {
      name: variables.name,
    });

    return this.provider.send(rendered, to);
  }
}
