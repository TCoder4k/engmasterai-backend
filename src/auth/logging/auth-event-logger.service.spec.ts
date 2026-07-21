import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthEventLogger } from './auth-event-logger.service';

describe('AuthEventLogger', () => {
  let config: jest.Mocked<ConfigService>;
  let logger: AuthEventLogger;
  let logSpy: jest.SpiedFunction<typeof Logger.prototype.log>;

  beforeEach(() => {
    config = {
      get: jest.fn().mockReturnValue('test'),
    } as unknown as jest.Mocked<ConfigService>;
    logger = new AuthEventLogger(config);
    logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('emits a single-line JSON payload containing the event name and allowlisted fields', () => {
    logger.log('auth.login.succeeded', {
      requestId: 'req-1',
      userId: 'user-1',
      role: 'USER',
      ipHash: 'abc123',
    });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(logSpy.mock.calls[0][0])) as Record<
      string,
      unknown
    >;
    expect(payload.event).toBe('auth.login.succeeded');
    expect(payload.userId).toBe('user-1');
    expect(payload.ipHash).toBe('abc123');
    expect(typeof payload.timestamp).toBe('string');
  });

  it('never emits forbidden substrings (passwords, tokens, cookies, Authorization headers)', () => {
    const forbidden = [
      'super-secret-password',
      'eyJhbGciOiJIUzI1NiJ9.faketoken',
      'Bearer eyJhbGci',
      'emai_rt=abc.def',
    ];

    logger.log('auth.login.failed', {
      requestId: 'req-2',
      emailHash: 'hash-not-raw-email',
      ipHash: 'hash-not-raw-ip',
      failureCategory: 'invalid_credentials',
    });

    const payload = String(logSpy.mock.calls[0][0]);
    for (const value of forbidden) {
      expect(payload).not.toContain(value);
    }
  });

  it('a logger failure does not throw — it falls back to a payload-free warning', () => {
    logSpy.mockImplementation(() => {
      throw new Error('sink unavailable');
    });
    const warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    expect(() =>
      logger.log('auth.login.succeeded', { userId: 'user-1' }),
    ).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith('structured auth logging failed');

    warnSpy.mockRestore();
  });
});
