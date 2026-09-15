import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { SepayWebhookVerificationException } from './exceptions/sepay-webhook-verification.exception';

// HMAC-SHA256 webhook authentication, verified directly against SePay's
// current official documentation on 2026-09-15
// (developer.sepay.vn/en/sepay-webhooks/xac-thuc, docs.sepay.vn/tich-hop-webhooks.html)
// — not an invented protocol. SePay's dashboard supports four modes (None,
// API Key, HMAC-SHA256, OAuth2); this app uses HMAC-SHA256, their
// recommended mode.
//
// Headers, exactly as documented: `X-SePay-Signature: sha256={hex_hmac}` and
// `X-SePay-Timestamp: {unix_seconds}`. Signed payload, quoted from the docs:
// concatenate `"{timestamp}.{raw_body}"`, then HMAC-SHA256 with the secret.
// Computed over the RAW request body bytes (req.rawBody, populated by
// main.ts's `{ rawBody: true }` bootstrap option) — SePay's docs warn
// explicitly that re-serializing the parsed body (`JSON.stringify(req.body)`)
// will not reproduce their signature, since key order/whitespace can differ
// from what they actually sent.
//
// Shaped after turnstile-verifier.service.ts's discipline: a typed exception
// on every failure mode, and a reason code logged — never the secret, the
// raw body, or the signature value itself.
const TIMESTAMP_TOLERANCE_SECONDS = 300; // SePay's own documented anti-replay window

@Injectable()
export class SepayWebhookVerifier {
  private readonly logger = new Logger(SepayWebhookVerifier.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Throws SepayWebhookVerificationException on any failure — a webhook
   * route has nothing useful to do with a boolean "false" other than
   * immediately reject, so making failure a throw keeps SepayWebhookGuard
   * (the only caller) a two-line wrapper.
   *
   * Checks run cheapest-first (header presence, then timestamp freshness,
   * then the actual HMAC computation) so a trivially malformed request never
   * pays for a hash.
   */
  verify(
    rawBody: Buffer,
    signatureHeader: string | undefined,
    timestampHeader: string | undefined,
  ): void {
    if (!signatureHeader || !timestampHeader) {
      this.reject('missing_headers');
    }

    const timestamp = Number(timestampHeader);
    if (!Number.isFinite(timestamp)) {
      this.reject('invalid_timestamp');
    }

    const ageSeconds = Math.abs(Date.now() / 1000 - timestamp);
    if (ageSeconds > TIMESTAMP_TOLERANCE_SECONDS) {
      this.reject('stale_timestamp');
    }

    const secret = this.config.get<string>(
      'PAYMENT_SEPAY_WEBHOOK_SECRET',
    ) as string;
    const expectedHex = createHmac('sha256', secret)
      .update(`${timestampHeader}.${rawBody.toString('utf8')}`)
      .digest('hex');

    const provided = signatureHeader.replace(/^sha256=/, '');
    const expectedBuf = Buffer.from(expectedHex, 'hex');
    const providedBuf = Buffer.from(provided, 'hex');

    // Length-checked BEFORE timingSafeEqual, which throws (rather than
    // returning false) on mismatched-length buffers — this is a correctness
    // requirement, not an optimization.
    if (
      expectedBuf.length !== providedBuf.length ||
      !timingSafeEqual(expectedBuf, providedBuf)
    ) {
      this.reject('bad_signature');
    }
  }

  private reject(reason: string): never {
    this.logger.warn(`SePay webhook verification failed: ${reason}`);
    throw new SepayWebhookVerificationException();
  }
}
