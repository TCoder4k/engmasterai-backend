import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionGrantService } from '../payment/subscription-grant.service';
import { ReferralAlreadyRedeemedException } from './referral.exceptions';

// 2026-09-16 pricing relaunch (Phase C) — "Mời một người bạn học thật → cả
// hai nhận 3 ngày PRO". A SEPARATE mechanism from Streak Together's own
// invite-link (that one pairs two people into a shared streak; this one is
// a one-time mutual PRO-days reward, tracked by the Referral model, not
// StreakPair). The reward fires on the INVITEE's first genuine study day,
// never at redemption — redeeming a code alone earns nothing, matching the
// campaign's "một người bạn HỌC THẬT" framing exactly.
const REFERRAL_REWARD_DAYS = 3;

// Module-local narrowing helper — same idiom this codebase already
// establishes in vocab-personal.service.ts/auth.service.ts/learning.service.ts
// (each domain keeps its own copy rather than a shared util for this one-liner).
const isUniqueConstraintViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2002';

@Injectable()
export class ReferralService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionGrant: SubscriptionGrantService,
  ) {}

  /** Lazy-generate-or-return the caller's own persistent referral code. */
  async getOrCreateCode(userId: string): Promise<{ code: string }> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { referralCode: true },
    });
    if (user.referralCode) return { code: user.referralCode };

    // Shorter than Streak's own 16-byte invite token (base64url of 6 bytes,
    // ~8 chars) — this one is meant to be spoken/typed/pasted as a short
    // code, not embedded in a shareable URL.
    const code = randomBytes(6).toString('base64url');
    await this.prisma.user.update({
      where: { id: userId },
      data: { referralCode: code },
    });
    return { code };
  }

  async redeem(userId: string, code: string): Promise<void> {
    const inviter = await this.prisma.user.findUnique({
      where: { referralCode: code },
      select: { id: true },
    });
    if (!inviter) throw new NotFoundException('Referral code not found');
    if (inviter.id === userId) {
      throw new BadRequestException("You can't use your own referral code");
    }

    try {
      await this.prisma.referral.create({
        data: { inviterId: inviter.id, inviteeId: userId },
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throw new ReferralAlreadyRedeemedException();
      }
      throw error;
    }
  }

  /**
   * Called from GamificationService.recordProgress's isNewDay gate — the
   * exact same hook point and gating StreakService.onUserActivityDay
   * already uses, so this reward is checked at most once per user per real
   * activity day, never on every single learning action.
   */
  async onUserActivityDay(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<void> {
    const referral = await tx.referral.findUnique({
      where: { inviteeId: userId },
    });
    if (!referral || referral.rewardGrantedAt) return;

    // Idempotent claim, same shape as LessonMilestoneService's own —
    // whichever concurrent caller wins this conditional update is the only
    // one that grants.
    const claimed = await tx.referral.updateMany({
      where: { id: referral.id, rewardGrantedAt: null },
      data: { rewardGrantedAt: new Date() },
    });
    if (claimed.count === 0) return;

    await Promise.all([
      this.subscriptionGrant.grantBonusDays(
        tx,
        referral.inviterId,
        REFERRAL_REWARD_DAYS,
      ),
      this.subscriptionGrant.grantBonusDays(
        tx,
        referral.inviteeId,
        REFERRAL_REWARD_DAYS,
      ),
    ]);
  }
}
