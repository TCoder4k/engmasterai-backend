import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TransactionalMailService } from './transactional-mail.service';
import { EmailTemplateRenderer } from './templates/email-template-renderer';
import { BrevoMailProvider } from './providers/brevo-mail.provider';
import { NullMailProvider } from './providers/null-mail.provider';
import { MAIL_PROVIDER } from './mail.types';

// Selected once at module-init time from EMAIL_ENABLED — never re-evaluated
// per request. When disabled (the default), every consumer of
// TransactionalMailService gets NullMailProvider automatically; no code
// path anywhere else needs to check EMAIL_ENABLED itself. Brevo is currently
// the only live adapter (Resend and SendGrid were both tried and removed the
// same day, 2026-08-20 — see docs/memory.md) — EMAIL_PROVIDER stays an
// explicit, validated config value rather than being deleted outright, so
// adding the next adapter (ADR 005) is again just a new class plus one
// switch case here, not a `MailModule` redesign.
@Module({
  imports: [ConfigModule],
  providers: [
    EmailTemplateRenderer,
    BrevoMailProvider,
    NullMailProvider,
    {
      provide: MAIL_PROVIDER,
      inject: [ConfigService, BrevoMailProvider, NullMailProvider],
      useFactory: (
        config: ConfigService,
        brevoProvider: BrevoMailProvider,
        nullProvider: NullMailProvider,
      ) => {
        if (config.get<boolean>('EMAIL_ENABLED') !== true) {
          return nullProvider;
        }
        return config.get<string>('EMAIL_PROVIDER') === 'brevo'
          ? brevoProvider
          : nullProvider;
      },
    },
    TransactionalMailService,
  ],
  exports: [TransactionalMailService],
})
export class MailModule {}
