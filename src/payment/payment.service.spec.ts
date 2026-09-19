import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PaymentService } from './payment.service';
import { PaymentCreationInProgressException } from './exceptions/payment-creation-in-progress.exception';

const CONFIG_DEFAULTS: Record<string, unknown> = {
  PAYMENT_PRO_MONTHLY_PRICE_VND: 199000,
  PAYMENT_ORDER_TTL_MINUTES: 15,
  PAYMENT_ACB_BANK_CODE: 'ACB',
  PAYMENT_ACB_ACCOUNT_NUMBER: '1234567890',
  PAYMENT_ACB_ACCOUNT_NAME: 'NGUYEN VAN A',
};

const buildService = (overrides: {
  payment?: Partial<Record<'findFirst' | 'create' | 'findUnique', jest.Mock>>;
  txPayment?: Partial<Record<'updateMany' | 'findFirstOrThrow', jest.Mock>>;
  executeRaw?: jest.Mock;
  redisSet?: jest.Mock;
  redisDel?: jest.Mock;
  config?: Record<string, unknown>;
}) => {
  const txExecuteRaw =
    overrides.executeRaw ?? jest.fn().mockResolvedValue(undefined);
  const txPayment = {
    updateMany:
      overrides.txPayment?.updateMany ??
      jest.fn().mockResolvedValue({ count: 0 }),
    findFirstOrThrow: overrides.txPayment?.findFirstOrThrow ?? jest.fn(),
  };

  const prisma = {
    payment: {
      findFirst:
        overrides.payment?.findFirst ?? jest.fn().mockResolvedValue(null),
      create:
        overrides.payment?.create ?? jest.fn().mockResolvedValue(paymentRow()),
      findUnique:
        overrides.payment?.findUnique ?? jest.fn().mockResolvedValue(null),
    },
    $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) =>
      fn({ payment: txPayment, $executeRaw: txExecuteRaw }),
    ),
  };

  const configValues = { ...CONFIG_DEFAULTS, ...overrides.config };
  const config = {
    get: (key: string, fallback?: unknown) =>
      key in configValues ? configValues[key] : fallback,
  };

  const redis = {
    set: overrides.redisSet ?? jest.fn().mockResolvedValue('OK'),
    del: overrides.redisDel ?? jest.fn().mockResolvedValue(1),
  };

  const service = new PaymentService(
    prisma as never,
    config as never,
    redis as never,
  );
  return { service, prisma, txPayment, txExecuteRaw, redis };
};

const paymentRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'payment-1',
  userId: 'user-1',
  plan: 'PRO_MONTHLY',
  amount: 199000,
  currency: 'VND',
  provider: 'BANK_TRANSFER',
  paymentCode: 'ENGABCD2345',
  status: 'PENDING',
  expiresAt: new Date(Date.now() + 15 * 60_000),
  providerTransactionId: null,
  paidAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('PaymentService.createOrReusePayment', () => {
  it('ignores any client-sent amount — price always comes from PAYMENT_PRO_MONTHLY_PRICE_VND', async () => {
    const { service, prisma } = buildService({
      config: { PAYMENT_PRO_MONTHLY_PRICE_VND: 249000 },
    });
    await service.createOrReusePayment('user-1', 'PRO_MONTHLY' as never);

    expect(prisma.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ amount: 249000 }),
      }),
    );
  });

  it('includes compareAtAmount when configured above the real price', async () => {
    const { service } = buildService({
      config: {
        PAYMENT_PRO_MONTHLY_PRICE_VND: 19000,
        PAYMENT_PRO_MONTHLY_COMPARE_AT_VND: 59000,
      },
      payment: {
        create: jest.fn().mockResolvedValue(paymentRow({ amount: 19000 })),
      },
    });
    const result = await service.createOrReusePayment(
      'user-1',
      'PRO_MONTHLY' as never,
    );
    expect(result.dto.compareAtAmount).toBe(59000);
  });

  it('is null when PAYMENT_PRO_MONTHLY_COMPARE_AT_VND is not configured', async () => {
    const { service } = buildService({
      payment: {
        create: jest.fn().mockResolvedValue(paymentRow({ amount: 199000 })),
      },
    });
    const result = await service.createOrReusePayment(
      'user-1',
      'PRO_MONTHLY' as never,
    );
    expect(result.dto.compareAtAmount).toBeNull();
  });

  it('defensively ignores a misconfigured compareAtAmount at or below the real price', async () => {
    const { service } = buildService({
      config: {
        PAYMENT_PRO_MONTHLY_PRICE_VND: 19000,
        PAYMENT_PRO_MONTHLY_COMPARE_AT_VND: 10000,
      },
      payment: {
        create: jest.fn().mockResolvedValue(paymentRow({ amount: 19000 })),
      },
    });
    const result = await service.createOrReusePayment(
      'user-1',
      'PRO_MONTHLY' as never,
    );
    expect(result.dto.compareAtAmount).toBeNull();
  });

  it('sets expiresAt to now + PAYMENT_ORDER_TTL_MINUTES', async () => {
    const before = Date.now();
    const { service, prisma } = buildService({
      config: { PAYMENT_ORDER_TTL_MINUTES: 15 },
    });
    await service.createOrReusePayment('user-1', 'PRO_MONTHLY' as never);
    const after = Date.now();

    const { expiresAt } = prisma.payment.create.mock.calls[0][0].data;
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + 15 * 60_000);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(after + 15 * 60_000);
  });

  it('reuses an existing live PENDING payment instead of creating a new one', async () => {
    const existing = paymentRow();
    const findFirst = jest.fn().mockResolvedValue(existing);
    const create = jest.fn();
    const { service } = buildService({ payment: { findFirst, create } });

    const result = await service.createOrReusePayment(
      'user-1',
      'PRO_MONTHLY' as never,
    );

    expect(result.created).toBe(false);
    expect(result.dto.paymentId).toBe('payment-1');
    expect(create).not.toHaveBeenCalled();
  });

  it("the create-or-reuse lookup only considers PENDING rows that haven't passed expiresAt", async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const { service } = buildService({ payment: { findFirst } });

    await service.createOrReusePayment('user-1', 'PRO_MONTHLY' as never);

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'PENDING',
          expiresAt: { gt: expect.any(Date) },
        }),
      }),
    );
  });

  it('retries payment-code generation on a simulated unique-constraint collision (P2002)', async () => {
    const collision = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed',
      {
        code: 'P2002',
        clientVersion: 'test',
      },
    );
    const create = jest
      .fn()
      .mockRejectedValueOnce(collision)
      .mockResolvedValueOnce(paymentRow());
    const { service } = buildService({ payment: { create } });

    const result = await service.createOrReusePayment(
      'user-1',
      'PRO_MONTHLY' as never,
    );

    expect(create).toHaveBeenCalledTimes(2);
    expect(result.created).toBe(true);
    // Two attempts must not reuse the same generated code.
    const firstCode = create.mock.calls[0][0].data.paymentCode;
    const secondCode = create.mock.calls[1][0].data.paymentCode;
    expect(firstCode).not.toBe(secondCode);
  });

  it('acquires the Redis create-lock and releases it after a successful create', async () => {
    const { service, redis } = buildService({});
    await service.createOrReusePayment('user-1', 'PRO_MONTHLY' as never);

    expect(redis.set).toHaveBeenCalledWith(
      'payment:create-lock:user-1:PRO_MONTHLY',
      '1',
      'EX',
      10,
      'NX',
    );
    expect(redis.del).toHaveBeenCalledWith(
      'payment:create-lock:user-1:PRO_MONTHLY',
    );
  });

  it('fails closed (503) when Redis errors while acquiring the create-lock', async () => {
    const { service } = buildService({
      redisSet: jest.fn().mockRejectedValue(new Error('down')),
    });

    await expect(
      service.createOrReusePayment('user-1', 'PRO_MONTHLY' as never),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("when the lock is already held, polls for the winner's row instead of racing it", async () => {
    const winnerRow = paymentRow();
    const findFirst = jest
      .fn()
      .mockResolvedValueOnce(null) // first poll attempt: not committed yet
      .mockResolvedValueOnce(winnerRow); // second poll attempt: winner has committed
    const { service } = buildService({
      redisSet: jest.fn().mockResolvedValue(null),
      payment: { findFirst },
    });

    const result = await service.createOrReusePayment(
      'user-1',
      'PRO_MONTHLY' as never,
    );

    expect(result.created).toBe(false);
    expect(result.dto.paymentId).toBe('payment-1');
  }, 10000);

  it('throws PaymentCreationInProgressException (409) if the lock stays held for the whole poll budget', async () => {
    const { service } = buildService({
      redisSet: jest.fn().mockResolvedValue(null),
      payment: { findFirst: jest.fn().mockResolvedValue(null) },
    });

    await expect(
      service.createOrReusePayment('user-1', 'PRO_MONTHLY' as never),
    ).rejects.toBeInstanceOf(PaymentCreationInProgressException);
  }, 10000);
});

describe('PaymentService.getOwnedPayment', () => {
  it('returns the payment for its owner', async () => {
    const { service } = buildService({
      payment: { findUnique: jest.fn().mockResolvedValue(paymentRow()) },
    });
    const dto = await service.getOwnedPayment('user-1', 'payment-1');
    expect(dto.paymentId).toBe('payment-1');
  });

  it("reports 404 (not 403) for another user's payment, identical to a truly unknown id", async () => {
    const { service } = buildService({
      payment: {
        findUnique: jest
          .fn()
          .mockResolvedValue(paymentRow({ userId: 'someone-else' })),
      },
    });
    await expect(
      service.getOwnedPayment('user-1', 'payment-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('reports 404 for a genuinely unknown id', async () => {
    const { service } = buildService({
      payment: { findUnique: jest.fn().mockResolvedValue(null) },
    });
    await expect(
      service.getOwnedPayment('user-1', 'missing'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('PaymentService.processSepayWebhook', () => {
  const baseDto = {
    id: 555,
    content: 'CHUYEN TIEN ENGABCD2345 THANH TOAN',
    code: 'WRONG-CODE', // SePay's own extraction — must never be trusted
    transferType: 'in' as const,
    transferAmount: 199000,
  };

  it('ignores outgoing transfers without touching the database', async () => {
    const { service, prisma } = buildService({});
    const result = await service.processSepayWebhook({
      ...baseDto,
      transferType: 'out',
    } as never);

    expect(result).toEqual({ outcome: 'ignored' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('is a no-op when no payment code can be found in `content`', async () => {
    const { service, prisma } = buildService({});
    const result = await service.processSepayWebhook({
      ...baseDto,
      content: 'no code here',
    } as never);

    expect(result).toEqual({ outcome: 'no-op', reason: 'no_code_found' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("parses the code from `content`, NEVER from SePay's own `code` field", async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const { service, txPayment } = buildService({ txPayment: { updateMany } });

    await service.processSepayWebhook(baseDto as never);

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ paymentCode: 'ENGABCD2345' }),
      }),
    );
    void txPayment;
  });

  it('is a safe no-op for an unmatched code, a wrong amount, or an already-paid duplicate (updateMany.count === 0)', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const executeRaw = jest.fn();
    const { service, txPayment } = buildService({
      txPayment: { updateMany },
      executeRaw,
    });

    const result = await service.processSepayWebhook(baseDto as never);

    expect(result).toEqual({
      outcome: 'no-op',
      reason: 'unmatched_or_already_paid',
    });
    expect(txPayment.findFirstOrThrow).not.toHaveBeenCalled();
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it('activates the subscription exactly once when the payment matches (updateMany.count === 1)', async () => {
    const matched = paymentRow({
      status: 'PAID',
      providerTransactionId: '555',
    });
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const findFirstOrThrow = jest.fn().mockResolvedValue(matched);
    const executeRaw = jest.fn().mockResolvedValue(undefined);
    const { service } = buildService({
      txPayment: { updateMany, findFirstOrThrow },
      executeRaw,
    });

    const result = await service.processSepayWebhook(baseDto as never);

    expect(result).toEqual({ outcome: 'activated', payment: matched });
    expect(executeRaw).toHaveBeenCalledTimes(1);
  });

  it('stores providerTransactionId as a string built from the numeric SePay id', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const findFirstOrThrow = jest.fn().mockResolvedValue(paymentRow());
    const { service } = buildService({
      txPayment: { updateMany, findFirstOrThrow },
    });

    await service.processSepayWebhook(baseDto as never);

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ providerTransactionId: '555' }),
      }),
    );
  });
});
