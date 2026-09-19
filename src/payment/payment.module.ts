import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { SepayWebhookVerifier } from './sepay-webhook-verifier.service';
import { SepayWebhookGuard } from './sepay-webhook.guard';
import { PaymentRateLimitGuard } from './rate-limit/payment-rate-limit.guard';
import { PaymentWebhookRateLimitGuard } from './rate-limit/payment-webhook-rate-limit.guard';
import { SubscriptionGrantService } from './subscription-grant.service';

// Sprint 14 — Payment/Subscription. Greenfield module, same shape as
// ChatModule: imports ONLY PrismaModule — AuthModule is @Global() and
// already exports RateLimiterService, SharedRedisModule is @Global() and
// already exports the Redis connection PaymentService/create-lock rely on.
@Module({
  imports: [PrismaModule],
  controllers: [PaymentController],
  providers: [
    PaymentService,
    SepayWebhookVerifier,
    SepayWebhookGuard,
    PaymentRateLimitGuard,
    PaymentWebhookRateLimitGuard,
    SubscriptionGrantService,
  ],
  exports: [SubscriptionGrantService],
})
export class PaymentModule {}
