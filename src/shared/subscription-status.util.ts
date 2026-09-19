import { PrismaService } from '../prisma/prisma.service';

// 2026-09-16 pricing relaunch — shared by every NEW PRO-tier gate this
// campaign adds (UsageQuotaService's callers). Same derivation UserService's
// SAFE_USER_SELECT and AdminStudentOverviewService already use inline
// (subscription !== null && expiresAt > now) — read fresh from the DB every
// call, NEVER trusted from a JWT claim (this app's access tokens carry no
// dynamic entitlement state by design). A plain function taking `prisma` as
// a parameter, not an injectable service, so any module can call it without
// adding a new DI dependency just for a three-line check.
export const isUserPro = async (
  prisma: PrismaService,
  userId: string,
): Promise<boolean> => {
  const subscription = await prisma.subscription.findUnique({
    where: { userId },
    select: { expiresAt: true },
  });
  return subscription !== null && subscription.expiresAt > new Date();
};

/**
 * One combined query (a single JOIN, not two round-trips) for the two
 * pieces of context every UsageQuotaService.checkAndIncrement call needs —
 * used by the four AI-feature call sites (Dictionary, Chat, Shadowing
 * feedback, Speaking attempt start).
 */
export const getProStatusAndTimeZone = async (
  prisma: PrismaService,
  userId: string,
): Promise<{ isPro: boolean; timeZone: string }> => {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { timezone: true, subscription: { select: { expiresAt: true } } },
  });
  return {
    isPro:
      user.subscription !== null && user.subscription.expiresAt > new Date(),
    timeZone: user.timezone ?? 'UTC',
  };
};
