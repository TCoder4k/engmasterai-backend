import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { Prisma, StreakInvitationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { enumerateDaysInTimeZone } from '../analytics/day-window';
import { startOfDayInTimeZone } from '../learning/timezone.util';
import { dayKeyToDate } from '../gamification/day-key';
import { canonicalPair, daysBetweenLabels } from './streak-day.util';
import {
  PairRelationshipDto,
  PublicStreakDto,
  StreakActivityToday,
  StreakDetailDto,
  StreakDayStatus,
  StreakInvitationDto,
  StreakPairDto,
  StreakPartnerDto,
} from './streak.types';

// 7 days from invite to auto-expiry. No job scheduler exists anywhere in
// this codebase, so expiry is checked lazily (at read/accept time via
// expiresAt), never flipped by a background sweep.
const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// After a DECLINE, the same pair cannot re-invite for 24h — anti-spam, not
// a hard product rule.
const DECLINE_COOLDOWN_MS = 24 * 60 * 60 * 1000;
// A generous ABUSE ceiling, not a product-facing limit — multiple
// concurrent streaks per user are allowed by design; this only stops a
// single account from accumulating an unbounded number of rows.
const MAX_ACTIVE_STREAKS_PER_USER = 100;
// The streak lengths that trigger a STREAK_MILESTONE notification.
const MILESTONES = [3, 7, 14, 30, 50, 100] as const;
// The Streak Detail calendar window (§F of the plan: "a 7-day calendar row").
const CALENDAR_WINDOW_DAYS = 7;
// Below this many active pairs, "Top N%" is not a meaningful stat — the
// whole userbase would trivially be "Top 100%".
const MIN_PAIRS_FOR_PERCENTILE = 5;

const SAFE_PARTNER_SELECT = {
  id: true,
  name: true,
  avatarUrl: true,
  level: true,
} as const;

type PairWithUsers = Prisma.StreakPairGetPayload<{
  include: { userLow: { select: typeof SAFE_PARTNER_SELECT }; userHigh: { select: typeof SAFE_PARTNER_SELECT } };
}>;

type InvitationWithUsers = Prisma.StreakInvitationGetPayload<{
  include: { inviter: { select: typeof SAFE_PARTNER_SELECT }; invitee: { select: typeof SAFE_PARTNER_SELECT } };
}>;

const toPartnerDto = (user: { id: string; name: string; avatarUrl: string | null; level: number }): StreakPartnerDto => ({
  id: user.id,
  name: user.name,
  avatarUrl: user.avatarUrl,
  level: user.level,
});

const toStreakPairDto = (pair: PairWithUsers, viewerId: string): StreakPairDto => ({
  id: pair.id,
  partner: toPartnerDto(pair.userLowId === viewerId ? pair.userHigh : pair.userLow),
  status: pair.status,
  currentStreak: pair.currentStreak,
  longestStreak: pair.longestStreak,
  startedAt: pair.startedAt.toISOString(),
  publicShareId: pair.publicShareId,
});

const toInvitationDto = (invitation: InvitationWithUsers, viewerId: string): StreakInvitationDto => ({
  id: invitation.id,
  direction: invitation.inviterId === viewerId ? 'sent' : 'received',
  counterpart: toPartnerDto(invitation.inviterId === viewerId ? invitation.invitee : invitation.inviter),
  status: invitation.status,
  createdAt: invitation.createdAt.toISOString(),
  expiresAt: invitation.expiresAt.toISOString(),
});

/**
 * `UserDailyActivity.day` round-tripped back to a 'YYYY-MM-DD' label. Safe
 * specifically because of how day-key.ts's dayKeyToDate encodes it (exact
 * UTC midnight of the calendar day, never re-interpreted) — this is the
 * inverse of that same encoding, not a fresh timezone conversion.
 */
const dayColumnToLabel = (day: Date): string => day.toISOString().slice(0, 10);

@Injectable()
export class StreakService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  // ---- invitations ----------------------------------------------------

  async sendInvitation(userId: string, inviteeId: string): Promise<StreakInvitationDto> {
    if (inviteeId === userId) {
      throw new BadRequestException("You can't invite yourself");
    }
    const invitee = await this.prisma.user.findUnique({ where: { id: inviteeId }, select: { id: true } });
    if (!invitee) throw new NotFoundException('User not found');

    const pairFilter = [{ inviterId: userId, inviteeId }, { inviterId: inviteeId, inviteeId: userId }];
    const [existingPending, recentDecline] = await Promise.all([
      this.prisma.streakInvitation.findFirst({
        where: { status: StreakInvitationStatus.PENDING, OR: pairFilter },
      }),
      this.prisma.streakInvitation.findFirst({
        where: {
          status: StreakInvitationStatus.DECLINED,
          respondedAt: { gte: new Date(Date.now() - DECLINE_COOLDOWN_MS) },
          OR: pairFilter,
        },
      }),
    ]);
    if (existingPending) {
      throw new ConflictException('An invitation already exists between you and this user');
    }
    if (recentDecline) {
      throw new ConflictException('Please wait before re-inviting this user');
    }

    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.streakInvitation.create({
        data: { inviterId: userId, inviteeId, expiresAt: new Date(Date.now() + INVITATION_TTL_MS) },
        include: { inviter: { select: SAFE_PARTNER_SELECT }, invitee: { select: SAFE_PARTNER_SELECT } },
      });
      await this.notifications.create(tx, inviteeId, 'STREAK_INVITATION_RECEIVED', {
        partnerId: created.inviter.id,
        partnerName: created.inviter.name,
        partnerAvatarUrl: created.inviter.avatarUrl,
        invitationId: created.id,
      });
      return created;
    });
    return toInvitationDto(row, userId);
  }

  async listInvitations(
    userId: string,
    direction?: 'sent' | 'received',
    status?: StreakInvitationStatus,
  ): Promise<StreakInvitationDto[]> {
    const where: Prisma.StreakInvitationWhereInput = {};
    if (direction === 'sent') where.inviterId = userId;
    else if (direction === 'received') where.inviteeId = userId;
    else where.OR = [{ inviterId: userId }, { inviteeId: userId }];
    if (status) where.status = status;

    const rows = await this.prisma.streakInvitation.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { inviter: { select: SAFE_PARTNER_SELECT }, invitee: { select: SAFE_PARTNER_SELECT } },
    });
    return rows.map((row) => toInvitationDto(row, userId));
  }

  async acceptInvitation(userId: string, invitationId: string): Promise<StreakPairDto> {
    return this.prisma.$transaction(async (tx) => {
      const invitation = await tx.streakInvitation.findUnique({
        where: { id: invitationId },
        include: { inviter: { select: SAFE_PARTNER_SELECT }, invitee: { select: SAFE_PARTNER_SELECT } },
      });
      if (!invitation) throw new NotFoundException('Invitation not found');
      if (invitation.inviteeId !== userId) throw new ForbiddenException();
      if (invitation.expiresAt.getTime() < Date.now()) {
        throw new GoneException('Invitation has expired');
      }

      // Atomic conditional update — the race guard. `count === 0` means
      // someone (another tab, a concurrent decline) already resolved this
      // invitation between the read above and here.
      const updated = await tx.streakInvitation.updateMany({
        where: { id: invitationId, status: StreakInvitationStatus.PENDING },
        data: { status: StreakInvitationStatus.ACCEPTED, respondedAt: new Date() },
      });
      if (updated.count === 0) throw new ConflictException('Invitation already resolved');

      const [userLowId, userHighId] = canonicalPair(invitation.inviterId, invitation.inviteeId);

      const activeCount = await tx.streakPair.count({
        where: { status: 'ACTIVE', OR: [{ userLowId: userId }, { userHighId: userId }] },
      });
      if (activeCount >= MAX_ACTIVE_STREAKS_PER_USER) {
        throw new ConflictException('Too many active streaks');
      }

      // Upsert, not insert — restarts an existing BROKEN pair IN PLACE
      // (preserving longestStreak/publicShareId) rather than creating a
      // duplicate, which @@unique([userLowId, userHighId]) would reject
      // anyway.
      const pair = await tx.streakPair.upsert({
        where: { userLowId_userHighId: { userLowId, userHighId } },
        create: { userLowId, userHighId, status: 'ACTIVE' },
        update: { status: 'ACTIVE', currentStreak: 0, lastQualifiedDay: null, startedAt: new Date() },
        include: { userLow: { select: SAFE_PARTNER_SELECT }, userHigh: { select: SAFE_PARTNER_SELECT } },
      });

      const acceptedBy = invitation.inviterId === userId ? invitation.inviter : invitation.invitee;
      await this.notifications.create(tx, invitation.inviterId, 'STREAK_INVITATION_ACCEPTED', {
        partnerId: acceptedBy.id,
        partnerName: acceptedBy.name,
        partnerAvatarUrl: acceptedBy.avatarUrl,
        streakId: pair.id,
      });

      return toStreakPairDto(pair, userId);
    });
  }

  async declineInvitation(userId: string, invitationId: string): Promise<void> {
    const invitation = await this.prisma.streakInvitation.findUnique({ where: { id: invitationId } });
    if (!invitation) throw new NotFoundException('Invitation not found');
    if (invitation.inviteeId !== userId) throw new ForbiddenException();

    const updated = await this.prisma.streakInvitation.updateMany({
      where: { id: invitationId, status: StreakInvitationStatus.PENDING },
      data: { status: StreakInvitationStatus.DECLINED, respondedAt: new Date() },
    });
    if (updated.count === 0) throw new ConflictException('Invitation already resolved');
  }

  async cancelInvitation(userId: string, invitationId: string): Promise<void> {
    const invitation = await this.prisma.streakInvitation.findUnique({ where: { id: invitationId } });
    if (!invitation) throw new NotFoundException('Invitation not found');
    if (invitation.inviterId !== userId) throw new ForbiddenException();

    const updated = await this.prisma.streakInvitation.updateMany({
      where: { id: invitationId, status: StreakInvitationStatus.PENDING },
      data: { status: StreakInvitationStatus.CANCELLED, respondedAt: new Date() },
    });
    if (updated.count === 0) throw new ConflictException('Invitation already resolved');
  }

  // ---- streaks (read) ---------------------------------------------------

  async listMyStreaks(userId: string): Promise<StreakPairDto[]> {
    const rows = await this.prisma.streakPair.findMany({
      where: { OR: [{ userLowId: userId }, { userHighId: userId }] },
      // 'ACTIVE' < 'BROKEN' lexicographically, so ascending puts active
      // pairs first without a CASE expression.
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
      include: { userLow: { select: SAFE_PARTNER_SELECT }, userHigh: { select: SAFE_PARTNER_SELECT } },
    });
    return rows.map((row) => toStreakPairDto(row, userId));
  }

  async getPairStatus(userId: string, otherUserId: string): Promise<PairRelationshipDto> {
    if (otherUserId === userId) throw new BadRequestException();

    const [userLowId, userHighId] = canonicalPair(userId, otherUserId);
    const pair = await this.prisma.streakPair.findUnique({
      where: { userLowId_userHighId: { userLowId, userHighId } },
      include: { userLow: { select: SAFE_PARTNER_SELECT }, userHigh: { select: SAFE_PARTNER_SELECT } },
    });
    if (pair) {
      return {
        relationship: pair.status === 'ACTIVE' ? 'active' : 'broken',
        streak: toStreakPairDto(pair, userId),
      };
    }

    const invitation = await this.prisma.streakInvitation.findFirst({
      where: {
        status: StreakInvitationStatus.PENDING,
        OR: [{ inviterId: userId, inviteeId: otherUserId }, { inviterId: otherUserId, inviteeId: userId }],
      },
      include: { inviter: { select: SAFE_PARTNER_SELECT }, invitee: { select: SAFE_PARTNER_SELECT } },
    });
    if (invitation) {
      return {
        relationship: invitation.inviterId === userId ? 'pending_sent' : 'pending_received',
        invitation: toInvitationDto(invitation, userId),
      };
    }

    return { relationship: 'none' };
  }

  /**
   * GET /streaks/:id — the richest read in the module. ~13 queries; fine
   * for a low-frequency detail view, not something on the recordProgress
   * hot path.
   */
  async getStreakDetail(userId: string, pairId: string): Promise<StreakDetailDto> {
    const pair = await this.prisma.streakPair.findUnique({
      where: { id: pairId },
      include: { userLow: { select: SAFE_PARTNER_SELECT }, userHigh: { select: SAFE_PARTNER_SELECT } },
    });
    if (!pair) throw new NotFoundException('Streak not found');
    this.assertParticipant(pair, userId);

    const partner = pair.userLowId === userId ? pair.userHigh : pair.userLow;

    const [meUser, partnerUser] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { timezone: true } }),
      this.prisma.user.findUniqueOrThrow({ where: { id: partner.id }, select: { timezone: true } }),
    ]);
    const meTimeZone = meUser.timezone ?? 'UTC';
    const partnerTimeZone = partnerUser.timezone ?? 'UTC';

    // The calendar window is enumerated from the VIEWER's own timezone —
    // it's their view of "the last 7 days". Each day's qualification is
    // then compared as a plain calendar-label string against BOTH users'
    // UserDailyActivity rows (each bucketed in ITS OWN owner's timezone at
    // write time) — the same label-not-instant comparison
    // onUserActivityDay uses, per the plan's timezone decision.
    const dayLabels = enumerateDaysInTimeZone(new Date(), meTimeZone, CALENDAR_WINDOW_DAYS);
    const windowStart = dayKeyToDate(dayLabels[0]);

    const [meDays, partnerDays, meActivityToday, partnerActivityToday, percentileRank] = await Promise.all([
      this.prisma.userDailyActivity.findMany({
        where: { userId, day: { gte: windowStart } },
        select: { day: true },
      }),
      this.prisma.userDailyActivity.findMany({
        where: { userId: partner.id, day: { gte: windowStart } },
        select: { day: true },
      }),
      this.describeActivity(userId, meTimeZone),
      this.describeActivity(partner.id, partnerTimeZone),
      this.percentileRank(pair.currentStreak),
    ]);

    const meDaySet = new Set(meDays.map((row) => dayColumnToLabel(row.day)));
    const partnerDaySet = new Set(partnerDays.map((row) => dayColumnToLabel(row.day)));
    const calendar: StreakDayStatus[] = dayLabels.map((day) => ({
      day,
      meQualified: meDaySet.has(day),
      partnerQualified: partnerDaySet.has(day),
    }));

    const todayLabel = dayLabels[dayLabels.length - 1];
    const isAtRiskToday = !(meDaySet.has(todayLabel) && partnerDaySet.has(todayLabel));

    return {
      ...toStreakPairDto(pair, userId),
      calendar,
      isAtRiskToday,
      meActivityToday,
      partnerActivityToday,
      percentileRank,
    };
  }

  /**
   * What kind of qualifying activity (if any) this user did on their own
   * "today". Only ever one of the three sources activity-window.ts already
   * defines as canonical — never a fabricated lesson/task title, which
   * would need extra joins this MVP does not add.
   */
  private async describeActivity(userId: string, timeZone: string): Promise<StreakActivityToday> {
    const dayStart = startOfDayInTimeZone(new Date(), timeZone);
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);

    const [step, attempt, review] = await Promise.all([
      this.prisma.lessonStepProgress.findFirst({
        where: { userId, lastActivityAt: { gte: dayStart, lt: dayEnd } },
        orderBy: { lastActivityAt: 'desc' },
        select: { lastActivityAt: true },
      }),
      this.prisma.lessonTaskAttempt.findFirst({
        where: { userId, submittedAt: { gte: dayStart, lt: dayEnd } },
        orderBy: { submittedAt: 'desc' },
        select: { submittedAt: true },
      }),
      this.prisma.wordReviewLog.findFirst({
        where: { userId, reviewedAt: { gte: dayStart, lt: dayEnd } },
        orderBy: { reviewedAt: 'desc' },
        select: { reviewedAt: true },
      }),
    ]);

    const candidates: { at: Date; label: StreakActivityToday['label'] }[] = [];
    if (step) candidates.push({ at: step.lastActivityAt, label: 'lesson' });
    if (attempt) candidates.push({ at: attempt.submittedAt, label: 'practice' });
    if (review) candidates.push({ at: review.reviewedAt, label: 'vocab' });
    if (candidates.length === 0) return { qualified: false, label: null, at: null };

    candidates.sort((a, b) => b.at.getTime() - a.at.getTime());
    return { qualified: true, label: candidates[0].label, at: candidates[0].at.toISOString() };
  }

  /** "Top N%" among currently-ACTIVE pairs. Two COUNTs; null below the sample floor. */
  private async percentileRank(currentStreak: number): Promise<number | null> {
    const total = await this.prisma.streakPair.count({ where: { status: 'ACTIVE' } });
    if (total < MIN_PAIRS_FOR_PERCENTILE) return null;

    const betterOrEqual = await this.prisma.streakPair.count({
      where: { status: 'ACTIVE', currentStreak: { gte: currentStreak } },
    });
    return Math.max(1, Math.round((betterOrEqual / total) * 100));
  }

  // ---- sharing ------------------------------------------------------------

  async generateShareLink(userId: string, pairId: string): Promise<{ shareId: string }> {
    const pair = await this.prisma.streakPair.findUnique({ where: { id: pairId } });
    if (!pair) throw new NotFoundException('Streak not found');
    this.assertParticipant(pair, userId);
    if (pair.publicShareId) return { shareId: pair.publicShareId };

    const shareId = randomBytes(16).toString('base64url');
    await this.prisma.streakPair.update({ where: { id: pairId }, data: { publicShareId: shareId } });
    return { shareId };
  }

  /**
   * PUBLIC, unauthenticated. Its own dedicated narrow select — deliberately
   * NEVER reuses toStreakPairDto/SAFE_PARTNER_SELECT, so an authenticated
   * field (id, level) can never leak onto this route by accident.
   */
  async getPublicStreak(shareId: string): Promise<PublicStreakDto> {
    const pair = await this.prisma.streakPair.findUnique({
      where: { publicShareId: shareId },
      select: {
        currentStreak: true,
        status: true,
        startedAt: true,
        userLow: { select: { name: true, avatarUrl: true } },
        userHigh: { select: { name: true, avatarUrl: true } },
      },
    });
    if (!pair) throw new NotFoundException('Streak not found');

    return {
      currentStreak: pair.currentStreak,
      status: pair.status,
      startedAt: pair.startedAt.toISOString(),
      userA: pair.userLow,
      userB: pair.userHigh,
    };
  }

  // ---- the recordProgress hook -------------------------------------------

  /**
   * Called from GamificationService.recordProgress, inside the SAME
   * transaction, ONLY when that call just opened a new UserDailyActivity
   * day for `userId` — mirroring how recordProgress's own currentStreak()
   * is gated ("runs at most once per student per day"). Doing this inside
   * the caller's transaction (not a post-commit fire-and-forget) matches
   * this codebase's existing atomicity philosophy for recordProgress: a
   * streak/notification write landing or rolling back together with the
   * activity that caused it, never disagreeing with it.
   */
  async onUserActivityDay(tx: Prisma.TransactionClient, userId: string, dayLabel: string): Promise<void> {
    const pairs = await tx.streakPair.findMany({
      where: { status: 'ACTIVE', OR: [{ userLowId: userId }, { userHighId: userId }] },
      include: { userLow: { select: SAFE_PARTNER_SELECT }, userHigh: { select: SAFE_PARTNER_SELECT } },
    });
    for (const pair of pairs) {
      await this.processPairActivity(tx, pair, userId, dayLabel);
    }
  }

  private async processPairActivity(
    tx: Prisma.TransactionClient,
    pair: PairWithUsers,
    userId: string,
    dayLabel: string,
  ): Promise<void> {
    const me = pair.userLowId === userId ? pair.userLow : pair.userHigh;
    const partner = pair.userLowId === userId ? pair.userHigh : pair.userLow;

    // Out-of-order relative to the pair's own high-water mark (can happen
    // across large timezone gaps between the two partners) — a day already
    // behind what's recorded is a no-op, never a fresh qualification
    // attempt.
    if (pair.lastQualifiedDay && dayLabel < pair.lastQualifiedDay) return;
    // Already counted (both partners' own activity on the same calendar
    // day each trigger this hook once) — idempotent no-op.
    if (pair.lastQualifiedDay === dayLabel) return;

    // A fully-past day with no qualification breaks the streak.
    if (pair.lastQualifiedDay && daysBetweenLabels(pair.lastQualifiedDay, dayLabel) > 1) {
      await tx.streakPair.update({ where: { id: pair.id }, data: { status: 'BROKEN', currentStreak: 0 } });
      await Promise.all([
        this.notifications.create(tx, pair.userLowId, 'STREAK_BROKEN', {
          partnerId: pair.userHigh.id,
          partnerName: pair.userHigh.name,
          partnerAvatarUrl: pair.userHigh.avatarUrl,
          streakId: pair.id,
        }),
        this.notifications.create(tx, pair.userHighId, 'STREAK_BROKEN', {
          partnerId: pair.userLow.id,
          partnerName: pair.userLow.name,
          partnerAvatarUrl: pair.userLow.avatarUrl,
          streakId: pair.id,
        }),
      ]);
      return;
    }

    const partnerDay = await tx.userDailyActivity.findUnique({
      where: { userId_day: { userId: partner.id, day: dayKeyToDate(dayLabel) } },
    });

    if (!partnerDay) {
      // Partner hasn't qualified today yet — event-driven nudge, no
      // scheduler involved (see NotificationType.STREAK_PARTNER_ACTIVE).
      await this.notifications.create(tx, partner.id, 'STREAK_PARTNER_ACTIVE', {
        partnerId: me.id,
        partnerName: me.name,
        partnerAvatarUrl: me.avatarUrl,
        streakId: pair.id,
      });
      return;
    }

    const nextStreak =
      pair.lastQualifiedDay && daysBetweenLabels(pair.lastQualifiedDay, dayLabel) === 1
        ? pair.currentStreak + 1
        : 1;
    const nextLongest = Math.max(pair.longestStreak, nextStreak);

    await tx.streakPair.update({
      where: { id: pair.id },
      data: { currentStreak: nextStreak, longestStreak: nextLongest, lastQualifiedDay: dayLabel },
    });

    if ((MILESTONES as readonly number[]).includes(nextStreak)) {
      await Promise.all([
        this.notifications.create(tx, pair.userLowId, 'STREAK_MILESTONE', {
          partnerId: pair.userHigh.id,
          partnerName: pair.userHigh.name,
          partnerAvatarUrl: pair.userHigh.avatarUrl,
          streakId: pair.id,
          days: nextStreak,
        }),
        this.notifications.create(tx, pair.userHighId, 'STREAK_MILESTONE', {
          partnerId: pair.userLow.id,
          partnerName: pair.userLow.name,
          partnerAvatarUrl: pair.userLow.avatarUrl,
          streakId: pair.id,
          days: nextStreak,
        }),
      ]);
    }
  }

  private assertParticipant(pair: { userLowId: string; userHighId: string }, userId: string): void {
    if (pair.userLowId !== userId && pair.userHighId !== userId) throw new ForbiddenException();
  }
}
