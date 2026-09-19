import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { randomInt, randomUUID } from 'crypto';
import { Payment, Prisma, SubscriptionPlan } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { paymentCreateLockKey } from './payment-redis.constants';
import { PaymentCreationInProgressException } from './exceptions/payment-creation-in-progress.exception';
import { SepayWebhookDto } from './dto/sepay-webhook.dto';
import {
  CreatePaymentResult,
  PaymentPresentationDto,
  PaymentPresentationStatus,
} from './payment.types';

// Server-authoritative pricing — the ONLY place an amount is ever decided.
// Read once per call (not cached) so an operator can change the price via
// env var without a restart-then-forget footgun... actually ConfigService
// values ARE fixed at boot (Joi validation runs once), so this is really
// "read from the validated boot-time config," same as every other env-driven
// value in this codebase.
const DURATION_DAYS: Record<SubscriptionPlan, number> = {
  PRO_MONTHLY: 30,
};

// Excludes visually-ambiguous characters (0/O, 1/I/L) — a payment code is
// meant to be reliably retyped/copy-pasted across different Vietnamese
// banking apps. 8 chars over a 33-char alphabet (~1.7e12 keyspace) plus the
// ENG prefix is 11 characters total, comfortably under VietQR's documented
// 25-character addInfo limit.
const PAYMENT_CODE_PREFIX = 'ENG';
const PAYMENT_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PAYMENT_CODE_LENGTH = 8;
const PAYMENT_CODE_PATTERN = new RegExp(
  `${PAYMENT_CODE_PREFIX}[${PAYMENT_CODE_ALPHABET}]{${PAYMENT_CODE_LENGTH}}`,
  'i',
);
const MAX_CODE_COLLISION_RETRIES = 5;

// The create-or-reuse lock (see payment-redis.constants.ts) only ever guards
// a single findFirst+create, which completes in low-single-digit
// milliseconds under normal operation — this TTL and poll budget are
// generous multiples of that, not tuned against real contention.
const LOCK_TTL_SECONDS = 10;
const LOCK_POLL_ATTEMPTS = 5;
const LOCK_POLL_INTERVAL_MS = 150;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const generatePaymentCode = (): string => {
  let code = PAYMENT_CODE_PREFIX;
  for (let i = 0; i < PAYMENT_CODE_LENGTH; i += 1) {
    code += PAYMENT_CODE_ALPHABET[randomInt(PAYMENT_CODE_ALPHABET.length)];
  }
  return code;
};

/**
 * SePay's own `code` field (its best-effort extraction) is documented as
 * unreliable — this parses the raw `content` field directly instead, and is
 * the ONLY thing PaymentService ever matches against. Case-insensitive
 * because different banking apps' transfer-content handling isn't
 * consistent; normalized to uppercase to match the stored paymentCode.
 */
const extractPaymentCode = (content: string): string | null => {
  const match = content.match(PAYMENT_CODE_PATTERN);
  return match ? match[0].toUpperCase() : null;
};

export type WebhookOutcome =
  | { outcome: 'ignored' }
  | { outcome: 'no-op'; reason: string }
  | { outcome: 'activated'; payment: Payment };

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  private getPlanPrice(plan: SubscriptionPlan): number {
    switch (plan) {
      case 'PRO_MONTHLY':
        return this.config.get<number>(
          'PAYMENT_PRO_MONTHLY_PRICE_VND',
        ) as number;
      default: {
        // Exhaustiveness guard — SubscriptionPlan has exactly one member
        // today; a new plan added to the enum without a price here is a
        // compile error via this `never` assignment, not a silent $0 charge.
        const exhaustive: never = plan;
        throw new Error(
          `No configured price for plan: ${exhaustive as string}`,
        );
      }
    }
  }

  // 2026-09-16 "Early Member" campaign — the struck-through "regular price"
  // shown next to the real charge. Display-only; ignored (returns null,
  // never a fake discount) whenever it isn't actually greater than the real
  // price, including when it's simply unset.
  private getPlanCompareAtPrice(
    plan: SubscriptionPlan,
    price: number,
  ): number | null {
    switch (plan) {
      case 'PRO_MONTHLY': {
        const raw = this.config.get<number>(
          'PAYMENT_PRO_MONTHLY_COMPARE_AT_VND',
        );
        return typeof raw === 'number' && raw > price ? raw : null;
      }
      default: {
        const exhaustive: never = plan;
        throw new Error(
          `No compare-at price handling for plan: ${exhaustive as string}`,
        );
      }
    }
  }

  private async findLivePending(
    userId: string,
    plan: SubscriptionPlan,
  ): Promise<Payment | null> {
    return this.prisma.payment.findFirst({
      where: { userId, plan, status: 'PENDING', expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async createNewPayment(
    userId: string,
    plan: SubscriptionPlan,
  ): Promise<Payment> {
    const amount = this.getPlanPrice(plan);
    const ttlMinutes = this.config.get<number>('PAYMENT_ORDER_TTL_MINUTES', 15);
    const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);

    for (let attempt = 0; attempt < MAX_CODE_COLLISION_RETRIES; attempt += 1) {
      try {
        return await this.prisma.payment.create({
          data: {
            userId,
            plan,
            amount,
            currency: 'VND',
            provider: 'BANK_TRANSFER',
            paymentCode: generatePaymentCode(),
            expiresAt,
          },
        });
      } catch (error) {
        // P2002 = unique constraint violation on paymentCode. Astronomically
        // unlikely at this keyspace, but retried rather than assumed away —
        // never check-then-insert (see the migration/schema comment).
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          continue;
        }
        throw error;
      }
    }
    throw new Error(
      'Failed to generate a unique payment code after multiple attempts',
    );
  }

  /**
   * POST /payments. Serializes the create-or-reuse DECISION with a short
   * Redis lock (design review, 2026-09-15) — a plain findFirst-then-create
   * is TOCTOU-unsafe against a double-click/retried request/two open tabs.
   * Redis is a concurrency guard for CREATION ONLY: settlement
   * (processSepayWebhook below) never touches it, so a Redis outage can only
   * ever make new-order creation fail closed, never corrupt payment state.
   */
  async createOrReusePayment(
    userId: string,
    plan: SubscriptionPlan,
  ): Promise<CreatePaymentResult> {
    const lockKey = paymentCreateLockKey(userId, plan);

    let acquired: string | null;
    try {
      acquired = await this.redis.set(
        lockKey,
        '1',
        'EX',
        LOCK_TTL_SECONDS,
        'NX',
      );
    } catch (error) {
      this.logger.error(
        'Redis SET NX failed while acquiring the payment create lock',
        error as Error,
      );
      throw new ServiceUnavailableException(
        'Payment service temporarily unavailable',
      );
    }

    if (acquired !== 'OK') {
      // Someone else is deciding right now — poll briefly for their result
      // rather than racing them (same shape as ChatIdempotencyStore.claim()'s
      // poll loop), instead of erroring immediately.
      for (let attempt = 0; attempt < LOCK_POLL_ATTEMPTS; attempt += 1) {
        await sleep(LOCK_POLL_INTERVAL_MS);
        const live = await this.findLivePending(userId, plan);
        if (live) return { dto: this.toDto(live), created: false };
      }
      throw new PaymentCreationInProgressException();
    }

    try {
      const live = await this.findLivePending(userId, plan);
      if (live) return { dto: this.toDto(live), created: false };

      const created = await this.createNewPayment(userId, plan);
      return { dto: this.toDto(created), created: true };
    } finally {
      try {
        await this.redis.del(lockKey);
      } catch (error) {
        this.logger.warn(
          `Best-effort payment create-lock release failed (userId=${userId}) — it will self-expire via its TTL`,
          error as Error,
        );
      }
    }
  }

  /** GET /payments/:id. Owner-only: a mismatch is reported identically to "not found" — never a 403 that would confirm the id exists to a non-owner. */
  async getOwnedPayment(
    userId: string,
    paymentId: string,
  ): Promise<PaymentPresentationDto> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });
    if (!payment || payment.userId !== userId) {
      throw new NotFoundException('Payment not found');
    }
    return this.toDto(payment);
  }

  /**
   * POST /payments/webhooks/sepay's business logic. Called only after
   * SepayWebhookGuard has already authenticated the request — everything
   * here assumes the caller is really SePay.
   *
   * No Redis anywhere in this path (design review, 2026-09-15): correctness
   * rests entirely on the `providerTransactionId: null` guard in the
   * `updateMany` below plus Payment.providerTransactionId's database-level
   * unique constraint. Every delivery — first attempt or the Nth retry,
   * concurrent or hours apart — runs this exact code; nothing short-circuits
   * before the database statement, so a retry can never be silently
   * swallowed without ever reaching the database.
   */
  async processSepayWebhook(dto: SepayWebhookDto): Promise<WebhookOutcome> {
    if (dto.transferType !== 'in') {
      return { outcome: 'ignored' };
    }

    const paymentCode = extractPaymentCode(dto.content);
    if (!paymentCode) {
      this.logger.warn(
        `SePay webhook: no payment code found in content (sepayTxId=${dto.id})`,
      );
      return { outcome: 'no-op', reason: 'no_code_found' };
    }

    return this.prisma.$transaction(async (tx) => {
      // NOT `status: { in: ['PENDING', 'EXPIRED'] }` — EXPIRED is never a
      // database value (see schema.prisma's Payment comment); a logically
      // expired-for-display row is still physically PENDING and still
      // settleable by a late webhook.
      const updated = await tx.payment.updateMany({
        where: {
          paymentCode,
          amount: dto.transferAmount,
          status: 'PENDING',
          providerTransactionId: null,
        },
        data: {
          status: 'PAID',
          providerTransactionId: String(dto.id),
          paidAt: new Date(),
        },
      });

      if (updated.count === 0) {
        // Unknown code, wrong amount, or a duplicate/retried delivery of an
        // already-PAID transaction — all indistinguishable at this layer on
        // purpose, and all a safe no-op. Retrying can't fix a business-logic
        // mismatch, so this is reported to SePay as a handled 200, not an
        // error (see the controller).
        this.logger.warn(
          `SePay webhook: no-op (paymentCode=${paymentCode}, amount=${dto.transferAmount}, sepayTxId=${dto.id})`,
        );
        return { outcome: 'no-op', reason: 'unmatched_or_already_paid' };
      }

      const payment = await tx.payment.findFirstOrThrow({
        where: { paymentCode, providerTransactionId: String(dto.id) },
      });

      await this.extendSubscriptionAtomically(tx, payment);

      return { outcome: 'activated', payment };
    });
  }

  /**
   * Single database-evaluated INSERT ... ON CONFLICT DO UPDATE — never an
   * app-level read-then-write (design review Critical finding, 2026-09-15:
   * two DIFFERENT concurrent successful payments for the same user must both
   * land; a JS-computed `base = current.expiresAt > now ? ... : now` read
   * before either commits can silently lose one payment's extension to
   * write-skew).
   *
   * `INSERT ... ON CONFLICT` takes a row-level lock on the conflicting row
   * before evaluating the SET expressions, so two concurrent statements
   * targeting the same userId serialize at the database: whichever commits
   * second sees the first's already-committed expiresAt via
   * `GREATEST(subscriptions."expiresAt", NOW())` and adds the purchased
   * duration on top of it — both extensions land, order irrelevant.
   *
   * Every interpolated value is bound by Prisma's tagged-template
   * parameterization, not string-concatenated; `payment.plan`/`payment.userId`/
   * `payment.id` come from a row already read inside this same transaction,
   * never directly from external webhook input.
   */
  private async extendSubscriptionAtomically(
    tx: Prisma.TransactionClient,
    payment: Payment,
  ): Promise<void> {
    const days = DURATION_DAYS[payment.plan];
    const id = randomUUID();

    await tx.$executeRaw`
      INSERT INTO subscriptions (id, "userId", plan, "startsAt", "expiresAt", "lastPaymentId", "createdAt", "updatedAt")
      VALUES (${id}, ${payment.userId}, ${payment.plan}::"SubscriptionPlan", NOW(), NOW() + (${days} * INTERVAL '1 day'), ${payment.id}, NOW(), NOW())
      ON CONFLICT ("userId") DO UPDATE SET
        plan            = EXCLUDED.plan,
        "expiresAt"     = GREATEST(subscriptions."expiresAt", NOW()) + (${days} * INTERVAL '1 day'),
        "lastPaymentId" = EXCLUDED."lastPaymentId",
        "updatedAt"     = NOW()
    `;
  }

  private toDto(payment: Payment): PaymentPresentationDto {
    const now = new Date();
    const status: PaymentPresentationStatus =
      payment.status === 'PENDING' && payment.expiresAt <= now
        ? 'EXPIRED'
        : payment.status;

    const bankCode = this.config.get<string>('PAYMENT_ACB_BANK_CODE', 'ACB');
    const accountNumber = this.config.get<string>(
      'PAYMENT_ACB_ACCOUNT_NUMBER',
    ) as string;
    const accountName = this.config.get<string>(
      'PAYMENT_ACB_ACCOUNT_NAME',
    ) as string;

    // Hosted VietQR "Quick Link" image — no API key, no SDK, no SePay secret
    // anywhere in this response. See docs/memory.md's Sprint 14 entry for the
    // full VietQR research this is based on.
    const qrUrl =
      `https://img.vietqr.io/image/${encodeURIComponent(bankCode)}-${encodeURIComponent(accountNumber)}-compact2.png` +
      `?amount=${payment.amount}&addInfo=${encodeURIComponent(payment.paymentCode)}&accountName=${encodeURIComponent(accountName)}`;

    return {
      paymentId: payment.id,
      plan: payment.plan,
      amount: payment.amount,
      compareAtAmount: this.getPlanCompareAtPrice(payment.plan, payment.amount),
      currency: payment.currency,
      paymentCode: payment.paymentCode,
      status,
      expiresAt: payment.expiresAt.toISOString(),
      bank: { code: bankCode, accountNumber, accountName },
      qrUrl,
    };
  }
}
