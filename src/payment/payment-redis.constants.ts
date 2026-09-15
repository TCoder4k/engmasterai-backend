import { SubscriptionPlan } from '@prisma/client';

// The ONLY Redis key this module owns. There is deliberately no webhook
// idempotency key here (design review, 2026-09-15): webhook correctness
// rests entirely on the database (Payment.providerTransactionId's unique
// constraint + a conditional updateMany — see PaymentService.
// processSepayWebhook), never on Redis. This lock exists purely to serialize
// the *decision* behind POST /payments' create-or-reuse check (a plain
// findFirst-then-create is TOCTOU-unsafe against a double-click/retried
// request/two open tabs) — it is a concurrency guard for payment CREATION
// only, never consulted during settlement, so a Redis outage can only ever
// make new-order creation fail closed (503), never corrupt or bypass
// payment/subscription state.
export const PAYMENT_CREATE_LOCK_PREFIX = 'payment:create-lock:';

export const paymentCreateLockKey = (
  userId: string,
  plan: SubscriptionPlan,
): string => `${PAYMENT_CREATE_LOCK_PREFIX}${userId}:${plan}`;
