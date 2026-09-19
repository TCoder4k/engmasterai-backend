import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WsAdapter } from '@nestjs/platform-ws';
import request from 'supertest';
import type { App } from 'supertest/types';
import { randomInt, randomUUID, createHmac } from 'crypto';

// Same alphabet PaymentService.generatePaymentCode uses (excludes 0/O/1/I) —
// fixture codes built here must stay within it, or extractPaymentCode's
// regex (which only matches this alphabet) would never find them in a
// webhook's `content`, same as it wouldn't for a real bank transfer.
const SAFE_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const randomSafeSuffix = (length: number): string =>
  Array.from(
    { length },
    () => SAFE_CODE_CHARS[randomInt(SAFE_CODE_CHARS.length)],
  ).join('');
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

// Sprint 14 — Payment/Subscription, end to end. Verifies the properties a
// unit test cannot reach: what actually lands in Postgres, real HTTP status
// codes, and genuine concurrency (Promise.all against a real connection
// pool) — most importantly the two design-review-driven guarantees a unit
// test can only simulate: (1) a duplicate SePay webhook delivery is a true
// database-level no-op, and (2) two DIFFERENT concurrent successful
// payments for the same user both extend the subscription (no write-skew).
//
// No fake provider override is needed here (unlike ENGY_CHAT_PROVIDER) —
// nothing in this flow calls a real external API; the "SePay webhook" is
// just an HTTP POST this suite signs itself with the test secret configured
// in .env.test.
const SEPAY_SECRET = 'e2e-test-secret';
const PRICE_VND = 19000;

describe('Payment + Subscription (e2e) — Sprint 14', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const createdUserIds: string[] = [];
  const createdPaymentIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication({ rawBody: true });
    // AppModule includes SpeakingLiveGateway — app.init() over the full
    // module graph needs an explicit WS adapter, same as every other e2e
    // suite that boots the whole AppModule.
    app.useWebSocketAdapter(new WsAdapter(app));
    app.useGlobalPipes(new ValidationPipe());
    await app.init();

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    if (createdPaymentIds.length) {
      await prisma.payment.deleteMany({
        where: { id: { in: createdPaymentIds } },
      });
    }
    if (createdUserIds.length) {
      // Cascades to each user's Subscription row too (onDelete: Cascade).
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await app.close();
  });

  const registerAndLogin = async (
    label: string,
  ): Promise<{ token: string; userId: string }> => {
    const email = `s14-${label.slice(0, 18)}-${randomUUID()}@example.test`;
    const register = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: `Sprint 14 ${label}`, email, password: 'password123' });
    const userId = (register.body as { user: { id: string } }).user.id;
    createdUserIds.push(userId);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'password123', role: 'USER' });
    return {
      token: (login.body as { accessToken: string }).accessToken,
      userId,
    };
  };

  const sign = (timestamp: string, rawBody: string): string =>
    `sha256=${createHmac('sha256', SEPAY_SECRET).update(`${timestamp}.${rawBody}`).digest('hex')}`;

  const sendWebhook = (
    payload: Record<string, unknown>,
    opts?: {
      timestamp?: string;
      signatureOverride?: string;
      rawBodyOverride?: string;
    },
  ) => {
    const rawBody = opts?.rawBodyOverride ?? JSON.stringify(payload);
    const timestamp = opts?.timestamp ?? String(Math.floor(Date.now() / 1000));
    const signature = opts?.signatureOverride ?? sign(timestamp, rawBody);
    return request(app.getHttpServer())
      .post('/payments/webhooks/sepay')
      .set('Content-Type', 'application/json')
      .set('X-SePay-Signature', signature)
      .set('X-SePay-Timestamp', timestamp)
      .send(rawBody);
  };

  const webhookPayload = (
    overrides: Partial<{
      id: number;
      content: string;
      transferAmount: number;
      transferType: 'in' | 'out';
    }>,
  ) => ({
    id: overrides.id ?? randomInt(1_000_000_000),
    gateway: 'ACB',
    transactionDate: new Date().toISOString(),
    accountNumber: '1234567890',
    content: overrides.content ?? 'test',
    code: 'IGNORED-BY-DESIGN',
    transferType: overrides.transferType ?? 'in',
    transferAmount: overrides.transferAmount ?? PRICE_VND,
    accumulated: 0,
    referenceCode: 'FT123456',
  });

  describe('POST /payments', () => {
    it('returns the server-configured price, never a client-sent one', async () => {
      const { token } = await registerAndLogin('price');
      const res = await request(app.getHttpServer())
        .post('/payments')
        .set('Authorization', `Bearer ${token}`)
        // Deliberately tries to smuggle a lower amount — CreatePaymentDto has
        // no `amount` field at all, so this is simply ignored.
        .send({ plan: 'PRO_MONTHLY', amount: 1 });

      expect(res.status).toBe(201);
      expect(res.body.amount).toBe(PRICE_VND);
      expect(res.body.currency).toBe('VND');
      expect(res.body.status).toBe('PENDING');
      expect(res.body.qrUrl).toContain('img.vietqr.io');
      expect(res.body).not.toHaveProperty('sepaySecret');
      createdPaymentIds.push(res.body.paymentId);
    });

    it('compareAtAmount is null when PAYMENT_PRO_MONTHLY_COMPARE_AT_VND is unset in this environment', async () => {
      const { token } = await registerAndLogin('compare-at');
      const res = await request(app.getHttpServer())
        .post('/payments')
        .set('Authorization', `Bearer ${token}`)
        .send({ plan: 'PRO_MONTHLY' });

      expect(res.status).toBe(201);
      expect(res.body.compareAtAmount).toBeNull();
      createdPaymentIds.push(res.body.paymentId);
    });

    it('reuses the existing live order for a second create call, instead of creating a new one', async () => {
      const { token } = await registerAndLogin('reuse');
      const first = await request(app.getHttpServer())
        .post('/payments')
        .set('Authorization', `Bearer ${token}`)
        .send({ plan: 'PRO_MONTHLY' });
      createdPaymentIds.push(first.body.paymentId);

      const second = await request(app.getHttpServer())
        .post('/payments')
        .set('Authorization', `Bearer ${token}`)
        .send({ plan: 'PRO_MONTHLY' });

      expect(second.status).toBe(200);
      expect(second.body.paymentId).toBe(first.body.paymentId);
      expect(second.body.paymentCode).toBe(first.body.paymentCode);
    });

    it('exactly one live payment order exists after two simultaneous create requests for the same user+plan', async () => {
      const { token, userId } = await registerAndLogin('concurrent-create');

      const [a, b] = await Promise.all([
        request(app.getHttpServer())
          .post('/payments')
          .set('Authorization', `Bearer ${token}`)
          .send({ plan: 'PRO_MONTHLY' }),
        request(app.getHttpServer())
          .post('/payments')
          .set('Authorization', `Bearer ${token}`)
          .send({ plan: 'PRO_MONTHLY' }),
      ]);

      expect([a.status, b.status].sort()).toEqual([200, 201]);
      expect(a.body.paymentId).toBe(b.body.paymentId);
      createdPaymentIds.push(a.body.paymentId);

      const rows = await prisma.payment.findMany({
        where: { userId, plan: 'PRO_MONTHLY' },
      });
      expect(rows).toHaveLength(1);
    });
  });

  describe('GET /payments/:id', () => {
    it("404s for another user's payment (never 403 — no existence leak)", async () => {
      const owner = await registerAndLogin('owner');
      const stranger = await registerAndLogin('stranger');
      const created = await request(app.getHttpServer())
        .post('/payments')
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ plan: 'PRO_MONTHLY' });
      createdPaymentIds.push(created.body.paymentId);

      const res = await request(app.getHttpServer())
        .get(`/payments/${created.body.paymentId}`)
        .set('Authorization', `Bearer ${stranger.token}`);

      expect(res.status).toBe(404);
    });

    it('400s for a malformed (non-UUID) id before ever reaching Prisma', async () => {
      const { token } = await registerAndLogin('bad-id');
      const res = await request(app.getHttpServer())
        .get('/payments/not-a-uuid')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(400);
    });
  });

  describe('POST /payments/webhooks/sepay — authentication', () => {
    it('rejects a webhook with an invalid signature, with no database change', async () => {
      const payload = webhookPayload({ content: 'ENGZZZZZZZZ' });
      const res = await sendWebhook(payload, {
        signatureOverride: `sha256=${'0'.repeat(64)}`,
      });
      expect(res.status).toBe(401);
    });

    it('rejects a stale timestamp', async () => {
      const payload = webhookPayload({ content: 'ENGZZZZZZZZ' });
      const staleTimestamp = String(Math.floor(Date.now() / 1000) - 600);
      const res = await sendWebhook(payload, { timestamp: staleTimestamp });
      expect(res.status).toBe(401);
    });

    it('rejects a malformed payload even with a valid signature', async () => {
      // A valid HMAC over a body missing required fields — proves signature
      // success alone does not bypass DTO validation.
      const res = await sendWebhook({ foo: 'bar' } as never);
      expect(res.status).toBe(400);
    });
  });

  describe('POST /payments/webhooks/sepay — settlement', () => {
    it('is a safe no-op for an unknown payment code (200, no activation)', async () => {
      const { token, userId } = await registerAndLogin('unknown-code');
      const payment = await request(app.getHttpServer())
        .post('/payments')
        .set('Authorization', `Bearer ${token}`)
        .send({ plan: 'PRO_MONTHLY' });
      createdPaymentIds.push(payment.body.paymentId);

      const res = await sendWebhook(
        webhookPayload({
          content: 'CHUYEN TIEN ENGNOTREAL1',
          transferAmount: PRICE_VND,
        }),
      );

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      const row = await prisma.payment.findUnique({
        where: { id: payment.body.paymentId },
      });
      expect(row?.status).toBe('PENDING');
      const sub = await prisma.subscription.findUnique({ where: { userId } });
      expect(sub).toBeNull();
    });

    it('is a safe no-op for the right code but the wrong amount (200, no activation)', async () => {
      const { token, userId } = await registerAndLogin('wrong-amount');
      const payment = await request(app.getHttpServer())
        .post('/payments')
        .set('Authorization', `Bearer ${token}`)
        .send({ plan: 'PRO_MONTHLY' });
      createdPaymentIds.push(payment.body.paymentId);

      const res = await sendWebhook(
        webhookPayload({
          content: `CHUYEN TIEN ${payment.body.paymentCode}`,
          transferAmount: 1000,
        }),
      );

      expect(res.status).toBe(200);
      const row = await prisma.payment.findUnique({
        where: { id: payment.body.paymentId },
      });
      expect(row?.status).toBe('PENDING');
      const sub = await prisma.subscription.findUnique({ where: { userId } });
      expect(sub).toBeNull();
    });

    it('ignores an outgoing transfer even if its content happens to contain a real code', async () => {
      const { token, userId } = await registerAndLogin('outgoing');
      const payment = await request(app.getHttpServer())
        .post('/payments')
        .set('Authorization', `Bearer ${token}`)
        .send({ plan: 'PRO_MONTHLY' });
      createdPaymentIds.push(payment.body.paymentId);

      const res = await sendWebhook(
        webhookPayload({
          content: `CHUYEN TIEN ${payment.body.paymentCode}`,
          transferAmount: PRICE_VND,
          transferType: 'out',
        }),
      );

      expect(res.status).toBe(200);
      const row = await prisma.payment.findUnique({
        where: { id: payment.body.paymentId },
      });
      expect(row?.status).toBe('PENDING');
      const sub = await prisma.subscription.findUnique({ where: { userId } });
      expect(sub).toBeNull();
    });

    it('a matching code + amount marks the payment PAID and activates the subscription (~+30 days)', async () => {
      const { token, userId } = await registerAndLogin('activate');
      const payment = await request(app.getHttpServer())
        .post('/payments')
        .set('Authorization', `Bearer ${token}`)
        .send({ plan: 'PRO_MONTHLY' });
      createdPaymentIds.push(payment.body.paymentId);

      const before = Date.now();
      const res = await sendWebhook(
        webhookPayload({
          content: `CHUYEN TIEN ${payment.body.paymentCode} THANH TOAN`,
          transferAmount: PRICE_VND,
        }),
      );
      expect(res.status).toBe(200);

      const row = await prisma.payment.findUnique({
        where: { id: payment.body.paymentId },
      });
      expect(row?.status).toBe('PAID');
      expect(row?.paidAt).not.toBeNull();

      const sub = await prisma.subscription.findUnique({ where: { userId } });
      expect(sub).not.toBeNull();
      const expectedMs = before + 30 * 24 * 60 * 60 * 1000;
      expect(sub!.expiresAt.getTime()).toBeGreaterThan(expectedMs - 60_000);
      expect(sub!.expiresAt.getTime()).toBeLessThan(expectedMs + 60_000);

      // GET /users/me now reports PRO status, derived from expiresAt alone.
      const me = await request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', `Bearer ${token}`);
      expect(me.body.isPro).toBe(true);
      expect(new Date(me.body.proExpiresAt).getTime()).toBe(
        sub!.expiresAt.getTime(),
      );
    });

    it('the SAME webhook delivered twice sequentially settles only once (DB-level idempotency, no Redis involved)', async () => {
      const { token, userId } = await registerAndLogin('retry-sequential');
      const payment = await request(app.getHttpServer())
        .post('/payments')
        .set('Authorization', `Bearer ${token}`)
        .send({ plan: 'PRO_MONTHLY' });
      createdPaymentIds.push(payment.body.paymentId);

      const payload = webhookPayload({
        content: `CK ${payment.body.paymentCode}`,
        transferAmount: PRICE_VND,
      });

      const first = await sendWebhook(payload);
      expect(first.status).toBe(200);
      const subAfterFirst = await prisma.subscription.findUnique({
        where: { userId },
      });

      // Identical body, identical id — a genuine SePay retry.
      const second = await sendWebhook(payload);
      expect(second.status).toBe(200);
      const subAfterSecond = await prisma.subscription.findUnique({
        where: { userId },
      });

      expect(subAfterSecond!.expiresAt.getTime()).toBe(
        subAfterFirst!.expiresAt.getTime(),
      );
    });

    it('two CONCURRENT deliveries of the identical webhook body activate exactly once', async () => {
      const { token, userId } = await registerAndLogin('retry-concurrent');
      const payment = await request(app.getHttpServer())
        .post('/payments')
        .set('Authorization', `Bearer ${token}`)
        .send({ plan: 'PRO_MONTHLY' });
      createdPaymentIds.push(payment.body.paymentId);

      const payload = webhookPayload({
        content: `CK ${payment.body.paymentCode}`,
        transferAmount: PRICE_VND,
      });

      const [a, b] = await Promise.all([
        sendWebhook(payload),
        sendWebhook(payload),
      ]);
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);

      const row = await prisma.payment.findUnique({
        where: { id: payment.body.paymentId },
      });
      expect(row?.status).toBe('PAID');

      const sub = await prisma.subscription.findUnique({ where: { userId } });
      const expectedMs = Date.now() + 30 * 24 * 60 * 60 * 1000;
      // Exactly one 30-day extension landed, not two (~60 days) — proves the
      // providerTransactionId unique-constraint + conditional updateMany
      // guard actually serialized the two concurrent deliveries.
      expect(sub!.expiresAt.getTime()).toBeLessThan(expectedMs + 60_000);
      expect(sub!.expiresAt.getTime()).toBeGreaterThan(expectedMs - 5 * 60_000);
    });

    it(
      'two DIFFERENT concurrent successful payments for the same user both extend the subscription — ' +
        'no write-skew (design-review Critical finding)',
      async () => {
        const { userId } = await registerAndLogin('write-skew');

        // Two independent PENDING payment rows for the same user+plan,
        // inserted directly as fixtures (the normal create-or-reuse API path
        // deliberately only ever keeps ONE live order per user+plan — see
        // PaymentService.findLivePending — so two genuinely independent
        // purchases are modeled here exactly as the approved plan
        // describes: direct fixture insertion of two PENDING rows).
        const expiresAt = new Date(Date.now() + 15 * 60_000);
        const paymentA = await prisma.payment.create({
          data: {
            userId,
            plan: 'PRO_MONTHLY',
            amount: PRICE_VND,
            currency: 'VND',
            provider: 'BANK_TRANSFER',
            paymentCode: `ENGSKEWA${randomSafeSuffix(3)}`,
            expiresAt,
          },
        });
        const paymentB = await prisma.payment.create({
          data: {
            userId,
            plan: 'PRO_MONTHLY',
            amount: PRICE_VND,
            currency: 'VND',
            provider: 'BANK_TRANSFER',
            paymentCode: `ENGSKEWB${randomSafeSuffix(3)}`,
            expiresAt,
          },
        });
        createdPaymentIds.push(paymentA.id, paymentB.id);

        const before = Date.now();
        const [resA, resB] = await Promise.all([
          sendWebhook(
            webhookPayload({
              content: `CK ${paymentA.paymentCode}`,
              transferAmount: PRICE_VND,
            }),
          ),
          sendWebhook(
            webhookPayload({
              content: `CK ${paymentB.paymentCode}`,
              transferAmount: PRICE_VND,
            }),
          ),
        ]);

        expect(resA.status).toBe(200);
        expect(resB.status).toBe(200);

        const [rowA, rowB] = await Promise.all([
          prisma.payment.findUnique({ where: { id: paymentA.id } }),
          prisma.payment.findUnique({ where: { id: paymentB.id } }),
        ]);
        expect(rowA?.status).toBe('PAID');
        expect(rowB?.status).toBe('PAID');

        const sub = await prisma.subscription.findUnique({ where: { userId } });
        expect(sub).not.toBeNull();
        // ~60 days, not ~30 — proves neither payment's 30-day extension was
        // lost to a read-then-write race (the atomic
        // GREATEST(expiresAt, now()) + 30d database expression is what makes
        // both extensions land regardless of commit order).
        const expectedMs = before + 60 * 24 * 60 * 60 * 1000;
        expect(sub!.expiresAt.getTime()).toBeGreaterThan(
          expectedMs - 5 * 60_000,
        );
        expect(sub!.expiresAt.getTime()).toBeLessThan(expectedMs + 5 * 60_000);
      },
    );
  });

  describe('GET /users/me — PRO entitlement derivation', () => {
    it('isPro is false once expiresAt has passed, even though the row still exists (no persisted status to go stale)', async () => {
      const { token, userId } = await registerAndLogin('expired-pro');
      await prisma.subscription.create({
        data: {
          userId,
          plan: 'PRO_MONTHLY',
          startsAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
          expiresAt: new Date(Date.now() - 1000),
          lastPaymentId: randomUUID(),
        },
      });

      const res = await request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', `Bearer ${token}`);

      expect(res.body.isPro).toBe(false);
      expect(res.body.proExpiresAt).not.toBeNull();
    });

    it('isPro is true while expiresAt is in the future', async () => {
      const { token, userId } = await registerAndLogin('active-pro');
      const expiresAt = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
      await prisma.subscription.create({
        data: {
          userId,
          plan: 'PRO_MONTHLY',
          startsAt: new Date(),
          expiresAt,
          lastPaymentId: randomUUID(),
        },
      });

      const res = await request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', `Bearer ${token}`);

      expect(res.body.isPro).toBe(true);
      expect(new Date(res.body.proExpiresAt).getTime()).toBe(
        expiresAt.getTime(),
      );
    });
  });
});
