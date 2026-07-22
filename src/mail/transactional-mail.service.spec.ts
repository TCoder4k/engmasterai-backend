import { ConfigService } from '@nestjs/config';
import { TransactionalMailService } from './transactional-mail.service';
import { EmailTemplateRenderer } from './templates/email-template-renderer';
import { MailProvider, MailSendResult } from './mail.types';

describe('TransactionalMailService', () => {
  let service: TransactionalMailService;
  let provider: jest.Mocked<MailProvider>;
  let renderer: EmailTemplateRenderer;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(() => {
    provider = { send: jest.fn() } as unknown as jest.Mocked<MailProvider>;
    renderer = new EmailTemplateRenderer();
    configService = {
      get: jest.fn((key: string) => {
        const values: Record<string, unknown> = {
          FRONTEND_APP_URL: 'https://app.example.com',
          EMAIL_VERIFICATION_TOKEN_TTL_MINUTES: 30,
        };
        return values[key];
      }),
    } as unknown as jest.Mocked<ConfigService>;

    service = new TransactionalMailService(provider, renderer, configService);
  });

  it('is always awaited by design — sendVerificationEmail returns a Promise<MailSendResult>, never fires-and-forgets', async () => {
    const successResult: MailSendResult = { success: true, durationMs: 12 };
    provider.send.mockResolvedValue(successResult);

    const result = await service.sendVerificationEmail('user@example.com', {
      name: 'Jane',
      rawToken: 'raw-token-value',
    });

    expect(result).toBe(successResult);
  });

  it('builds the verification URL from FRONTEND_APP_URL and the raw token, and passes it to the renderer', async () => {
    provider.send.mockResolvedValue({ success: true, durationMs: 1 });

    await service.sendVerificationEmail('user@example.com', {
      name: 'Jane',
      rawToken: 'raw-token-value',
    });

    const [rendered, to] = provider.send.mock.calls[0] as [
      { html: string; text: string },
      string,
    ];
    expect(to).toBe('user@example.com');
    expect(rendered.html).toContain(
      'https://app.example.com/verify-email?token=raw-token-value',
    );
  });

  it('propagates a structured failure result unchanged, without throwing', async () => {
    const failure: MailSendResult = {
      success: false,
      failureCategory: 'timeout',
      durationMs: 5000,
    };
    provider.send.mockResolvedValue(failure);

    const result = await service.sendVerificationEmail('user@example.com', {
      name: 'Jane',
      rawToken: 'raw-token-value',
    });

    expect(result).toEqual(failure);
  });

  it('never passes a raw token or template identifier to the provider — only already-rendered content', async () => {
    provider.send.mockResolvedValue({ success: true, durationMs: 1 });

    await service.sendVerificationEmail('user@example.com', {
      name: 'Jane',
      rawToken: 'super-secret-raw-token',
    });

    const [rendered] = provider.send.mock.calls[0] as [
      Record<string, unknown>,
      string,
    ];
    expect(rendered).not.toHaveProperty('template');
    expect(rendered).not.toHaveProperty('rawToken');
    // The token legitimately appears embedded inside the rendered verifyUrl
    // (that's the whole point of the email) — but never as a bare field.
    expect(Object.keys(rendered).sort()).toEqual(['html', 'subject', 'text']);
  });
});
