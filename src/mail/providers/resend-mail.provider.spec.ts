import { ConfigService } from '@nestjs/config';
import { ResendMailProvider } from './resend-mail.provider';
import { RenderedEmail } from '../mail.types';

const rendered: RenderedEmail = {
  subject: 'Test subject',
  html: '<p>hello</p>',
  text: 'hello',
};

describe('ResendMailProvider', () => {
  let provider: ResendMailProvider;
  let configService: jest.Mocked<ConfigService>;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    configService = {
      get: jest.fn((key: string) => {
        const values: Record<string, unknown> = {
          EMAIL_PROVIDER_API_KEY: 'test-api-key',
          EMAIL_FROM: 'noreply@example.com',
          EMAIL_FROM_NAME: 'EngMasterAI',
          EMAIL_PROVIDER_TIMEOUT_MS: 5000,
        };
        return values[key];
      }),
    } as unknown as jest.Mocked<ConfigService>;

    provider = new ResendMailProvider(configService);

    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns a success MailSendResult on a 2xx provider response — no real network call is made (fetch is mocked)', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: 'resend-message-id-1' }),
    });

    const result = await provider.send(rendered, 'user@example.com');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.providerMessageId).toBe('resend-message-id-1');
      expect(typeof result.durationMs).toBe('number');
    }
  });

  it('never leaks the raw fetch Response object — only a MailSendResult is ever returned', async () => {
    const rawResponse = {
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({ id: 'resend-message-id-1', secret: 'leak-me-not' }),
    };
    fetchMock.mockResolvedValue(rawResponse);

    const result = await provider.send(rendered, 'user@example.com');

    expect(result).not.toBe(rawResponse);
    expect(JSON.stringify(result)).not.toContain('leak-me-not');
  });

  it('maps a non-2xx provider response to a structured provider_rejected failure, never throwing', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 422,
      json: () => Promise.resolve({ message: 'invalid recipient' }),
    });

    const result = await provider.send(rendered, 'user@example.com');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.failureCategory).toBe('provider_rejected');
    }
  });

  it('maps a thrown network error to a structured network_error failure, never rethrowing', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    const result = await provider.send(rendered, 'user@example.com');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.failureCategory).toBe('network_error');
    }
  });

  it('maps an aborted (timed-out) request to a structured timeout failure, never rethrowing', async () => {
    fetchMock.mockImplementation(() => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      return Promise.reject(abortError);
    });

    const result = await provider.send(rendered, 'user@example.com');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.failureCategory).toBe('timeout');
    }
  });

  it('returns invalid_configuration when required config is missing at send time, without calling fetch', async () => {
    configService.get.mockImplementation((key: string) =>
      key === 'EMAIL_PROVIDER_TIMEOUT_MS' ? 5000 : undefined,
    );

    const result = await provider.send(rendered, 'user@example.com');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.failureCategory).toBe('invalid_configuration');
    }
  });

  it('sends only already-rendered content plus the recipient — never a template id or raw variables', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: 'x' }),
    });

    await provider.send(rendered, 'user@example.com');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.subject).toBe(rendered.subject);
    expect(body.html).toBe(rendered.html);
    expect(body.text).toBe(rendered.text);
    expect(body.to).toEqual(['user@example.com']);
    expect(body).not.toHaveProperty('template');
    expect(body).not.toHaveProperty('variables');
  });
});
