import { ExecutionContext, ServiceUnavailableException } from '@nestjs/common';
import { PaymentWebhookRateLimitGuard } from './payment-webhook-rate-limit.guard';
import { RateLimitExceededException } from '../../auth/exceptions/rate-limit-exceeded.exception';

const buildContext = (ip: string): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ ip }) }),
  }) as unknown as ExecutionContext;

describe('PaymentWebhookRateLimitGuard', () => {
  it('keys the Redis counter by request IP, never a userId bucket (this route has no authenticated user)', async () => {
    const rateLimiter = {
      checkAndIncrement: jest
        .fn()
        .mockResolvedValue({ allowed: true, count: 1 }),
    };
    const guard = new PaymentWebhookRateLimitGuard(rateLimiter as never);

    await guard.canActivate(buildContext('203.0.113.7'));

    expect(rateLimiter.checkAndIncrement).toHaveBeenCalledWith(
      'payment:webhook:203.0.113.7',
      30,
      60,
    );
  });

  it('throws RateLimitExceededException once the bucket is exhausted', async () => {
    const rateLimiter = {
      checkAndIncrement: jest
        .fn()
        .mockResolvedValue({ allowed: false, count: 31 }),
    };
    const guard = new PaymentWebhookRateLimitGuard(rateLimiter as never);

    await expect(
      guard.canActivate(buildContext('203.0.113.7')),
    ).rejects.toBeInstanceOf(RateLimitExceededException);
  });

  it('fails closed when Redis itself is unavailable', async () => {
    const rateLimiter = {
      checkAndIncrement: jest
        .fn()
        .mockRejectedValue(new ServiceUnavailableException()),
    };
    const guard = new PaymentWebhookRateLimitGuard(rateLimiter as never);

    await expect(
      guard.canActivate(buildContext('203.0.113.7')),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
