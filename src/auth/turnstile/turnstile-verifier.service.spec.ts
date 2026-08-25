import { ConfigService } from '@nestjs/config';
import { TurnstileVerifierService } from './turnstile-verifier.service';
import { CaptchaVerificationFailedException } from '../exceptions/captcha-verification-failed.exception';

// `fetch` is stubbed throughout, same convention as
// dictionary/free-dictionary-api.provider.spec.ts.

const config = (values: Record<string, unknown> = {}): ConfigService =>
  ({
    get: (key: string, fallback?: unknown) =>
      key in values ? values[key] : fallback,
  }) as unknown as ConfigService;

const enabledConfig = (overrides: Record<string, unknown> = {}) =>
  config({
    TURNSTILE_ENABLED: true,
    TURNSTILE_SECRET_KEY: 'test-secret',
    ...overrides,
  });

const okResponse = (body: unknown): Response =>
  ({ ok: true, status: 200, json: () => Promise.resolve(body) }) as unknown as Response;

afterEach(() => {
  jest.restoreAllMocks();
});

describe('TurnstileVerifierService', () => {
  it('is a no-op and never calls fetch when TURNSTILE_ENABLED is false', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const service = new TurnstileVerifierService(config({ TURNSTILE_ENABLED: false }));

    await expect(service.verify('some-token', '1.2.3.4')).resolves.toBeUndefined();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects an undefined token without calling fetch', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const service = new TurnstileVerifierService(enabledConfig());

    await expect(service.verify(undefined, '1.2.3.4')).rejects.toBeInstanceOf(
      CaptchaVerificationFailedException,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects an empty-string token without calling fetch', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const service = new TurnstileVerifierService(enabledConfig());

    await expect(service.verify('', '1.2.3.4')).rejects.toBeInstanceOf(
      CaptchaVerificationFailedException,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects when Cloudflare responds 200 with success:false', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(okResponse({ success: false }));
    const service = new TurnstileVerifierService(enabledConfig());

    await expect(service.verify('token', '1.2.3.4')).rejects.toBeInstanceOf(
      CaptchaVerificationFailedException,
    );
  });

  it('resolves when Cloudflare responds 200 with success:true', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(okResponse({ success: true }));
    const service = new TurnstileVerifierService(enabledConfig());

    await expect(service.verify('token', '1.2.3.4')).resolves.toBeUndefined();
  });

  it('rejects a non-2xx response from Cloudflare', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: false, status: 500 } as unknown as Response);
    const service = new TurnstileVerifierService(enabledConfig());

    await expect(service.verify('token', '1.2.3.4')).rejects.toBeInstanceOf(
      CaptchaVerificationFailedException,
    );
  });

  it('rejects on a network error', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('offline'));
    const service = new TurnstileVerifierService(enabledConfig());

    await expect(service.verify('token', '1.2.3.4')).rejects.toBeInstanceOf(
      CaptchaVerificationFailedException,
    );
  });

  it('rejects on a timeout (AbortError)', async () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    jest.spyOn(global, 'fetch').mockRejectedValue(abort);
    const service = new TurnstileVerifierService(enabledConfig());

    await expect(service.verify('token', '1.2.3.4')).rejects.toBeInstanceOf(
      CaptchaVerificationFailedException,
    );
  });

  it('rejects a malformed (non-JSON-parseable) response body', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.reject(new Error('not json')),
    } as unknown as Response);
    const service = new TurnstileVerifierService(enabledConfig());

    await expect(service.verify('token', '1.2.3.4')).rejects.toBeInstanceOf(
      CaptchaVerificationFailedException,
    );
  });

  it('sends the exact remoteIp it was given in the request body', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(okResponse({ success: true }));
    const service = new TurnstileVerifierService(enabledConfig());

    await service.verify('token', '203.0.113.42');

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({
      secret: 'test-secret',
      response: 'token',
      remoteip: '203.0.113.42',
    });
  });

  it('omits remoteip entirely when given null, rather than sending a placeholder', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(okResponse({ success: true }));
    const service = new TurnstileVerifierService(enabledConfig());

    await service.verify('token', null);

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.remoteip).toBeUndefined();
  });
});
