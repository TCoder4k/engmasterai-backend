import { Test, TestingModule } from '@nestjs/testing';
import { WsAdapter } from '@nestjs/platform-ws';
import { randomUUID } from 'crypto';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { UsageQuotaService } from './usage-quota.service';
import { UsageQuotaExceededException } from './usage-quota.exceptions';

// Integration coverage against the real Postgres instance, same convention
// as vocab-personal.service.spec.ts — the property under test (the atomic
// `INSERT ... ON CONFLICT DO UPDATE ... WHERE count < limit` statement never
// letting two concurrent requests both squeeze past the last unit of quota)
// cannot be meaningfully proven against a mocked PrismaService.
describe('UsageQuotaService (integration — real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: UsageQuotaService;

  const createdUserIds: string[] = [];

  const createUser = async (): Promise<string> => {
    const user = await prisma.user.create({
      data: {
        email: `usage-quota-test-${randomUUID()}@example.test`,
        name: 'Usage Quota Test User',
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
    service = app.get(UsageQuotaService);
  }, 30000);

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await moduleRef.close();
  }, 30000);

  it('increments from nothing to 1 on the first call', async () => {
    const userId = await createUser();

    const result = await service.checkAndIncrement(
      userId,
      'aiGrading',
      false,
      'UTC',
    );

    expect(result).toMatchObject({ kind: 'aiGrading', used: 1, limit: 2 });
  });

  it('rejects the 3rd aiGrading call for a Free user (limit 2), without incrementing', async () => {
    const userId = await createUser();
    await service.checkAndIncrement(userId, 'aiGrading', false, 'UTC');
    await service.checkAndIncrement(userId, 'aiGrading', false, 'UTC');

    await expect(
      service.checkAndIncrement(userId, 'aiGrading', false, 'UTC'),
    ).rejects.toBeInstanceOf(UsageQuotaExceededException);

    const status = await service.getStatus(userId, false, 'UTC');
    const aiGrading = status.find((s) => s.kind === 'aiGrading');
    expect(aiGrading?.used).toBe(2); // the rejected 3rd call did NOT increment
  });

  it('a PRO user gets the higher limit for the same kind', async () => {
    const userId = await createUser();
    for (let i = 0; i < 2; i += 1) {
      await service.checkAndIncrement(userId, 'aiGrading', true, 'UTC');
    }

    // Still fine — PRO limit is 30, not 2.
    await expect(
      service.checkAndIncrement(userId, 'aiGrading', true, 'UTC'),
    ).resolves.toMatchObject({ used: 3, limit: 30 });
  });

  it('exactly one request wins when two concurrent calls race the last remaining unit of quota', async () => {
    const userId = await createUser();
    // Consume 4 of the 5 aiQuery units up front, leaving exactly 1.
    for (let i = 0; i < 4; i += 1) {
      await service.checkAndIncrement(userId, 'aiQuery', false, 'UTC');
    }

    const results = await Promise.allSettled([
      service.checkAndIncrement(userId, 'aiQuery', false, 'UTC'),
      service.checkAndIncrement(userId, 'aiQuery', false, 'UTC'),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const status = await service.getStatus(userId, false, 'UTC');
    expect(status.find((s) => s.kind === 'aiQuery')?.used).toBe(5);
  });

  it('speaking is now a MONTHLY quota (3 per month)', async () => {
    const userId = await createUser();
    for (let i = 0; i < 3; i += 1) {
      await service.checkAndIncrement(userId, 'speaking', false, 'UTC');
    }

    await expect(
      service.checkAndIncrement(userId, 'speaking', false, 'UTC'),
    ).rejects.toBeInstanceOf(UsageQuotaExceededException);

    const status = await service.getStatus(userId, false, 'UTC');
    const speaking = status.find((s) => s.kind === 'speaking');
    expect(speaking?.period).toBe('month');
    expect(speaking?.periodKey).toMatch(/^\d{4}-\d{2}$/);
  });

  it('getStatus reports 0/limit for a user with no usage yet, for every kind', async () => {
    const userId = await createUser();

    const status = await service.getStatus(userId, false, 'UTC');

    expect(status).toHaveLength(3);
    expect(status.every((s) => s.used === 0)).toBe(true);
  });
});
