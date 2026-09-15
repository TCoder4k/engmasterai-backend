import { createHmac } from 'crypto';
import { SepayWebhookVerifier } from './sepay-webhook-verifier.service';
import { SepayWebhookVerificationException } from './exceptions/sepay-webhook-verification.exception';

const SECRET = 'test-secret';

const sign = (timestamp: string, rawBody: Buffer): string =>
  `sha256=${createHmac('sha256', SECRET)
    .update(`${timestamp}.${rawBody.toString('utf8')}`)
    .digest('hex')}`;

const buildVerifier = () => {
  const config = {
    get: (key: string) =>
      key === 'PAYMENT_SEPAY_WEBHOOK_SECRET' ? SECRET : undefined,
  };
  return new SepayWebhookVerifier(config as never);
};

describe('SepayWebhookVerifier', () => {
  const rawBody = Buffer.from('{"id":1,"content":"ENGABCD2345"}', 'utf8');

  it('accepts a correctly computed signature within the timestamp window', () => {
    const verifier = buildVerifier();
    const timestamp = String(Math.floor(Date.now() / 1000));
    expect(() =>
      verifier.verify(rawBody, sign(timestamp, rawBody), timestamp),
    ).not.toThrow();
  });

  it('rejects a missing signature header', () => {
    const verifier = buildVerifier();
    const timestamp = String(Math.floor(Date.now() / 1000));
    expect(() => verifier.verify(rawBody, undefined, timestamp)).toThrow(
      SepayWebhookVerificationException,
    );
  });

  it('rejects a missing timestamp header', () => {
    const verifier = buildVerifier();
    expect(() =>
      verifier.verify(rawBody, 'sha256=deadbeef', undefined),
    ).toThrow(SepayWebhookVerificationException);
  });

  it('rejects a non-numeric timestamp', () => {
    const verifier = buildVerifier();
    expect(() =>
      verifier.verify(rawBody, 'sha256=deadbeef', 'not-a-number'),
    ).toThrow(SepayWebhookVerificationException);
  });

  it('rejects a timestamp more than 5 minutes old', () => {
    const verifier = buildVerifier();
    const staleTimestamp = String(Math.floor(Date.now() / 1000) - 301);
    expect(() =>
      verifier.verify(rawBody, sign(staleTimestamp, rawBody), staleTimestamp),
    ).toThrow(SepayWebhookVerificationException);
  });

  it('rejects a correct-length-but-wrong signature', () => {
    const verifier = buildVerifier();
    const timestamp = String(Math.floor(Date.now() / 1000));
    const wrongSignature = `sha256=${'0'.repeat(64)}`;
    expect(() => verifier.verify(rawBody, wrongSignature, timestamp)).toThrow(
      SepayWebhookVerificationException,
    );
  });

  it('rejects a mismatched-length signature without ever calling timingSafeEqual on unequal buffers', () => {
    const verifier = buildVerifier();
    const timestamp = String(Math.floor(Date.now() / 1000));
    expect(() =>
      verifier.verify(rawBody, 'sha256=deadbeef', timestamp),
    ).toThrow(SepayWebhookVerificationException);
  });

  it('rejects a signature computed over a DIFFERENT body than the one provided (raw-body integrity)', () => {
    const verifier = buildVerifier();
    const timestamp = String(Math.floor(Date.now() / 1000));
    const otherBody = Buffer.from('{"id":2,"content":"TAMPERED"}', 'utf8');
    expect(() =>
      verifier.verify(rawBody, sign(timestamp, otherBody), timestamp),
    ).toThrow(SepayWebhookVerificationException);
  });

  it('never includes the secret in a thrown error', () => {
    const verifier = buildVerifier();
    try {
      verifier.verify(rawBody, undefined, undefined);
      fail('expected verify to throw');
    } catch (error) {
      expect(JSON.stringify((error as Error).message)).not.toContain(SECRET);
      expect(
        (error as SepayWebhookVerificationException).getResponse(),
      ).not.toEqual(expect.objectContaining({ secret: expect.anything() }));
    }
  });
});
