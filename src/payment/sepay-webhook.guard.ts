import {
  CanActivate,
  ExecutionContext,
  Injectable,
  RawBodyRequest,
} from '@nestjs/common';
import type { Request } from 'express';
import { SepayWebhookVerifier } from './sepay-webhook-verifier.service';
import { SepayWebhookVerificationException } from './exceptions/sepay-webhook-verification.exception';

// Runs FIRST on POST /payments/webhooks/sepay, before
// PaymentWebhookRateLimitGuard (see payment.controller.ts's @UseGuards
// order) — unsigned/forged traffic is rejected here before it ever consumes
// a rate-limit slot. A thin CanActivate adapter around SepayWebhookVerifier's
// pure logic, same separation as RateLimiterService (logic) /
// ChatRateLimitGuard (adapter).
@Injectable()
export class SepayWebhookGuard implements CanActivate {
  constructor(private readonly verifier: SepayWebhookVerifier) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<RawBodyRequest<Request>>();

    if (!req.rawBody) {
      // Should be impossible given main.ts's `{ rawBody: true }` bootstrap
      // option, which populates this for every route — a defensive
      // fail-closed rather than a silent bypass if that ever regresses.
      throw new SepayWebhookVerificationException();
    }

    this.verifier.verify(
      req.rawBody,
      req.header('X-SePay-Signature'),
      req.header('X-SePay-Timestamp'),
    );
    return true;
  }
}
