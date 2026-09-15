import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { RateLimiterService } from '../../auth/rate-limit/rate-limiter.service';
import { RateLimitExceededException } from '../../auth/exceptions/rate-limit-exceeded.exception';

// Only one route ever uses this (POST /payments/webhooks/sepay), so unlike
// PaymentRateLimitGuard there is no per-route decorator/policy — the limit is
// fixed here. IP-keyed, NEVER the userId-keyed `payment:${kind}:${userId}`
// buckets above: there is no authenticated user on this route at all.
//
// MUST run AFTER SepayWebhookGuard (see payment.controller.ts's
// @UseGuards(SepayWebhookGuard, PaymentWebhookRateLimitGuard) ordering) —
// unsigned/forged traffic is rejected by signature verification before it
// ever reaches this counter, so the trusted webhook bucket is never consumed
// by junk.
//
// Requires TRUST_PROXY to be configured correctly in production behind a
// reverse proxy/load balancer for req.ip to reflect SePay's real source IP
// rather than the proxy's own address (see main.ts's `app.set('trust proxy', ...)`
// and src/config/trust-proxy.util.ts — this guard adds no new proxy-handling
// code, it just depends on that existing setting being correct).
const WEBHOOK_IP_RATE_LIMIT_MAX = 30;
const WEBHOOK_IP_RATE_LIMIT_WINDOW_SECONDS = 60;

@Injectable()
export class PaymentWebhookRateLimitGuard implements CanActivate {
  constructor(private readonly rateLimiter: RateLimiterService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const key = `payment:webhook:${req.ip}`;
    const result = await this.rateLimiter.checkAndIncrement(
      key,
      WEBHOOK_IP_RATE_LIMIT_MAX,
      WEBHOOK_IP_RATE_LIMIT_WINDOW_SECONDS,
    );
    if (!result.allowed) {
      throw new RateLimitExceededException();
    }
    return true;
  }
}
