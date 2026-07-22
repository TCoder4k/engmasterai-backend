import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TransactionalMailService } from './transactional-mail.service';
import { EmailTemplateRenderer } from './templates/email-template-renderer';
import { ResendMailProvider } from './providers/resend-mail.provider';
import { NullMailProvider } from './providers/null-mail.provider';
import { MAIL_PROVIDER } from './mail.types';

// Selected once at module-init time from EMAIL_ENABLED — never re-evaluated
// per request. When disabled (the default), every consumer of
// TransactionalMailService gets NullMailProvider automatically; no code
// path anywhere else needs to check EMAIL_ENABLED itself.
@Module({
  imports: [ConfigModule],
  providers: [
    EmailTemplateRenderer,
    ResendMailProvider,
    NullMailProvider,
    {
      provide: MAIL_PROVIDER,
      inject: [ConfigService, ResendMailProvider, NullMailProvider],
      useFactory: (
        config: ConfigService,
        resendProvider: ResendMailProvider,
        nullProvider: NullMailProvider,
      ) =>
        config.get<boolean>('EMAIL_ENABLED') === true
          ? resendProvider
          : nullProvider,
    },
    TransactionalMailService,
  ],
  exports: [TransactionalMailService],
})
export class MailModule {}
