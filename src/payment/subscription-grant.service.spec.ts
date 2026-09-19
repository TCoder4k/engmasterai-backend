import { Test, TestingModule } from '@nestjs/testing';
import { WsAdapter } from '@nestjs/platform-ws';
import { randomUUID } from 'crypto';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionGrantService } from './subscription-grant.service';

// Integration coverage against real Postgres — the property under test (the
// atomic GREATEST(...)-based extension, identical reasoning to
// PaymentService.extendSubscriptionAtomically's own e2e-proven guarantee)
// cannot be meaningfully proven against a mocked PrismaService.
describe('SubscriptionGrantService (integration — real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: SubscriptionGrantService;

  const createdUserIds: string[] = [];

  const createUser = async (): Promise<string> => {
    const user = await prisma.user.create({
      data: {
        email: `sub-grant-test-${randomUUID()}@example.test`,
        name: 'Subscription Grant Test User',
        password: 'irrelevant',
      },
    });
    createdUserIds.push(user.id);
    return user.id;
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const app = moduleRef.createNestApplication();
    app.useWebSocketAdapter(new WsAdapter(app));
    await app.init();
    prisma = app.get(PrismaService);
    service = app.get(SubscriptionGrantService);
  }, 30000);

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await moduleRef.close();
  }, 30000);

  it('creates a fresh Subscription with no Payment/lastPaymentId for a user who has never paid', async () => {
    const userId = await createUser();

    await service.grantBonusDays(prisma, userId, 7);

    const sub = await prisma.subscription.findUniqueOrThrow({
      where: { userId },
    });
    expect(sub.lastPaymentId).toBeNull();
    expect(sub.plan).toBe('PRO_MONTHLY');
    const daysLeft =
      (sub.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(daysLeft).toBeGreaterThan(6.9);
    expect(daysLeft).toBeLessThan(7.1);
  });

  it('extends an existing, still-active subscription by GREATEST(expiresAt, now) + days, not overwriting it', async () => {
    const userId = await createUser();
    const future = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
    await prisma.subscription.create({
      data: {
        userId,
        plan: 'PRO_MONTHLY',
        startsAt: new Date(),
        expiresAt: future,
        lastPaymentId: randomUUID(), // a real payment already extended this
      },
    });

    await service.grantBonusDays(prisma, userId, 3);

    const sub = await prisma.subscription.findUniqueOrThrow({
      where: { userId },
    });
    const daysLeft =
      (sub.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(daysLeft).toBeGreaterThan(22.9); // ~20 + 3, not reset to 3
    expect(sub.lastPaymentId).not.toBeNull(); // untouched, still points at the real payment
  });

  it('extends an already-EXPIRED subscription from now, not from its stale expiresAt', async () => {
    const userId = await createUser();
    const past = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    await prisma.subscription.create({
      data: {
        userId,
        plan: 'PRO_MONTHLY',
        startsAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
        expiresAt: past,
        lastPaymentId: randomUUID(),
      },
    });

    await service.grantBonusDays(prisma, userId, 3);

    const sub = await prisma.subscription.findUniqueOrThrow({
      where: { userId },
    });
    const daysLeft =
      (sub.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(daysLeft).toBeGreaterThan(2.9);
    expect(daysLeft).toBeLessThan(3.1);
  });

  it('two concurrent grants for the same user both land (no write-skew)', async () => {
    const userId = await createUser();

    await Promise.all([
      service.grantBonusDays(prisma, userId, 7),
      service.grantBonusDays(prisma, userId, 3),
    ]);

    const sub = await prisma.subscription.findUniqueOrThrow({
      where: { userId },
    });
    const daysLeft =
      (sub.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(daysLeft).toBeGreaterThan(9.9); // both 7 and 3 landed, not just one
  });
});
