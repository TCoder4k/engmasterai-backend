import { HttpException, HttpStatus } from '@nestjs/common';

// Thrown by SepayWebhookVerifier/SepayWebhookGuard for any authentication
// failure (missing headers, stale timestamp, bad signature) — always 401,
// and the message/body never includes the secret, the raw body, or which
// specific check failed (that detail is logged server-side as a reason code
// only — see SepayWebhookVerifier's own comment).
export class SepayWebhookVerificationException extends HttpException {
  constructor() {
    super(
      {
        statusCode: HttpStatus.UNAUTHORIZED,
        code: 'SEPAY_WEBHOOK_VERIFICATION_FAILED',
        message: 'Webhook authentication failed.',
      },
      HttpStatus.UNAUTHORIZED,
    );
  }
}
