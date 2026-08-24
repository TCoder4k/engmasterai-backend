import { StreakInvitationStatus, StreakPairStatus } from '@prisma/client';

// Deliberately narrower than user.service.ts's own SAFE_USER_SELECT (no
// email/role/totalPoints/createdAt) — same "each module owns its own
// cross-user-safe projection" precedent as community-chat's
// SAFE_AUTHOR_SELECT. Never used for the PUBLIC share endpoint, which has
// its own even-narrower select (see StreakService.getPublicStreak).
export interface StreakPartnerDto {
  id: string;
  name: string;
  avatarUrl: string | null;
  level: number;
}

export interface StreakPairDto {
  id: string;
  partner: StreakPartnerDto;
  status: StreakPairStatus;
  currentStreak: number;
  longestStreak: number;
  startedAt: string;
  publicShareId: string | null;
}

export interface StreakDayStatus {
  day: string; // 'YYYY-MM-DD'
  meQualified: boolean;
  partnerQualified: boolean;
  /** True for a day later than "today" in the viewer's own timezone — the
   * remainder of the fixed Mon-Sun calendar week, which hasn't happened yet
   * and must be rendered as "not yet", never as "missed". */
  isFuture: boolean;
}

export interface StreakActivityToday {
  qualified: boolean;
  // A generic category, never a fabricated lesson/task title — see
  // StreakService.describeActivity for why only these three are possible.
  label: 'lesson' | 'practice' | 'vocab' | 'listening' | null;
  at: string | null;
}

export interface StreakDetailDto extends StreakPairDto {
  calendar: StreakDayStatus[];
  isAtRiskToday: boolean;
  meActivityToday: StreakActivityToday;
  partnerActivityToday: StreakActivityToday;
  /** "Top N%" among active pairs — null until there's a meaningful sample. */
  percentileRank: number | null;
}

export interface StreakInvitationDto {
  id: string;
  direction: 'sent' | 'received';
  counterpart: StreakPartnerDto;
  status: StreakInvitationStatus;
  createdAt: string;
  expiresAt: string;
}

export type PairRelationship = 'none' | 'pending_sent' | 'pending_received' | 'active' | 'broken';

export interface PairRelationshipDto {
  relationship: PairRelationship;
  streak?: StreakPairDto;
  invitation?: StreakInvitationDto;
}

// GET /streaks/leaderboard — top active pairs by currentStreak. Deliberately
// minimal: no invented "flame tier" name, no per-pair tagline/motto (no such
// data exists anywhere — see StreakService.getLeaderboard). totalXp is a
// real, honest derivation (both members' User.totalPoints summed), not a
// fabricated stat.
export interface LeaderboardEntryDto {
  rank: number;
  pairId: string;
  userA: StreakPartnerDto;
  userB: StreakPartnerDto;
  currentStreak: number;
  longestStreak: number;
  totalXp: number;
  isCurrentUserPair: boolean;
}

// The ONLY shape ever returned by GET /streaks/public/:shareId — built from
// its own dedicated narrow Prisma select, never by reusing toStreakPairDto,
// so an authenticated field can never leak onto the public route by
// accident. No internal ids, no email, no level, no activity history.
export interface PublicStreakDto {
  currentStreak: number;
  status: StreakPairStatus;
  startedAt: string;
  userA: { name: string; avatarUrl: string | null };
  userB: { name: string; avatarUrl: string | null };
}
