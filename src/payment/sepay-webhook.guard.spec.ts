import { ExecutionContext } from '@nestjs/common';
import { SepayWebhookGuard } from './sepay-webhook.guard';
import { SepayWebhookVerificationException } from './exceptions/sepay-webhook-verification.exception';

const buildContext = (req: Record<string, unknown>): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => req }),
  }) as unknown as ExecutionContext;

describe('SepayWebhookGuard', () => {
  it('allows the request through when verification succeeds', () => {
    const verify = jest.fn();
    const guard = new SepayWebhookGuard({ verify } as never);
    const req = {
      rawBody: Buffer.from('{"id":1}', 'utf8'),
      header: (name: string) =>
        name === 'X-SePay-Signature' ? 'sha256=abc' : '1700000000',
    };

    expect(guard.canActivate(buildContext(req))).toBe(true);
    expect(verify).toHaveBeenCalledWith(
      req.rawBody,
      'sha256=abc',
      '1700000000',
    );
  });

  it('denies with SepayWebhookVerificationException when the verifier throws', () => {
    const verify = jest.fn().mockImplementation(() => {
      throw new SepayWebhookVerificationException();
    });
    const guard = new SepayWebhookGuard({ verify } as never);
    const req = {
      rawBody: Buffer.from('{}', 'utf8'),
      header: () => undefined,
    };

    expect(() => guard.canActivate(buildContext(req))).toThrow(
      SepayWebhookVerificationException,
    );
  });

  it('fails closed when req.rawBody is missing (should be impossible given main.ts, but never a silent bypass)', () => {
    const verify = jest.fn();
    const guard = new SepayWebhookGuard({ verify } as never);
    const req = { rawBody: undefined, header: () => undefined };

    expect(() => guard.canActivate(buildContext(req))).toThrow(
      SepayWebhookVerificationException,
    );
    expect(verify).not.toHaveBeenCalled();
  });

  it('hashes req.rawBody, not a re-serialization of req.body — proven by the guard never even reading req.body', () => {
    const verify = jest.fn();
    const guard = new SepayWebhookGuard({ verify } as never);
    // req.body deliberately differs from rawBody's actual bytes (reordered
    // keys) — if the guard used req.body it would pass a different string
    // to verify() than the raw bytes SePay actually signed.
    const req = {
      rawBody: Buffer.from('{"id":1,"content":"X"}', 'utf8'),
      body: { content: 'X', id: 1 },
      header: (name: string) =>
        name === 'X-SePay-Signature' ? 'sha256=abc' : '1700000000',
    };

    guard.canActivate(buildContext(req));

    expect(verify).toHaveBeenCalledWith(
      req.rawBody,
      expect.anything(),
      expect.anything(),
    );
  });
});
