import { Test, TestingModule } from '@nestjs/testing';
import { WsAdapter } from '@nestjs/platform-ws';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { ReferralService } from './referral.service';
import { ReferralAlreadyRedeemedException } from './referral.exceptions';

// Integration coverage against real Postgres — same convention as
// vocab-personal.service.spec.ts / usage-quota.service.spec.ts.
describe('ReferralService (integration — real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: ReferralService;

  const createdUserIds: string[] = [];

  const createUser = async (): Promise<string> => {
    const user = await prisma.user.create({
      data: {
        email: `referral-test-${randomUUID()}@example.test`,
        name: 'Referral Test User',
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
    service = app.get(ReferralService);
  }, 30000);

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await moduleRef.close();
  }, 30000);

  it('lazily creates a code once, then returns the same one on a second call', async () => {
    const userId = await createUser();

    const first = await service.getOrCreateCode(userId);
    const second = await service.getOrCreateCode(userId);

    expect(first.code).toBe(second.code);
    expect(first.code.length).toBeGreaterThan(4);
  });

  it('rejects using your own referral code', async () => {
    const userId = await createUser();
    const { code } = await service.getOrCreateCode(userId);

    await expect(service.redeem(userId, code)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('404s redeeming an unknown code', async () => {
    const userId = await createUser();

    await expect(
      service.redeem(userId, 'not-a-real-code'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('creates a Referral row on redemption, with no reward yet', async () => {
    const inviter = await createUser();
    const invitee = await createUser();
    const { code } = await service.getOrCreateCode(inviter);

    await service.redeem(invitee, code);

    const referral = await prisma.referral.findUniqueOrThrow({
      where: { inviteeId: invitee },
    });
    expect(referral.inviterId).toBe(inviter);
    expect(referral.rewardGrantedAt).toBeNull();
  });

  it('rejects a second redemption by the same invitee, even against a different inviter', async () => {
    const inviterA = await createUser();
    const inviterB = await createUser();
    const invitee = await createUser();
    const codeA = (await service.getOrCreateCode(inviterA)).code;
    const codeB = (await service.getOrCreateCode(inviterB)).code;

    await service.redeem(invitee, codeA);

    await expect(service.redeem(invitee, codeB)).rejects.toBeInstanceOf(
      ReferralAlreadyRedeemedException,
    );
  });

  it("onUserActivityDay grants BOTH sides +3 days PRO exactly once, on the invitee's first activity day", async () => {
    const inviter = await createUser();
    const invitee = await createUser();
    const { code } = await service.getOrCreateCode(inviter);
    await service.redeem(invitee, code);

    await prisma.$transaction((tx) => service.onUserActivityDay(tx, invitee));

    const [inviterSub, inviteeSub] = await Promise.all([
      prisma.subscription.findUniqueOrThrow({ where: { userId: inviter } }),
      prisma.subscription.findUniqueOrThrow({ where: { userId: invitee } }),
    ]);
    for (const sub of [inviterSub, inviteeSub]) {
      const daysLeft =
        (sub.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
      expect(daysLeft).toBeGreaterThan(2.9);
      expect(daysLeft).toBeLessThan(3.1);
    }

    // A second activity day must NOT grant a second +3 days to either side.
    await prisma.$transaction((tx) => service.onUserActivityDay(tx, invitee));
    const inviterSubAfter = await prisma.subscription.findUniqueOrThrow({
      where: { userId: inviter },
    });
    const daysLeftAfter =
      (inviterSubAfter.expiresAt.getTime() - Date.now()) /
      (24 * 60 * 60 * 1000);
    expect(daysLeftAfter).toBeLessThan(3.1);
  });

  it('onUserActivityDay is a no-op for a user who was never referred', async () => {
    const userId = await createUser();

    await prisma.$transaction((tx) => service.onUserActivityDay(tx, userId));

    await expect(
      prisma.subscription.findUnique({ where: { userId } }),
    ).resolves.toBeNull();
  });
});
