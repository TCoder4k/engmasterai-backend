import { NotificationType } from '@prisma/client';

// One shape for every notification type — `payload` is intentionally loose
// (module-local unions below) rather than one DTO per NotificationType,
// mirroring CommunityMessageDto's "one shape, one mapper" precedent.
export interface NotificationDto {
  id: string;
  type: NotificationType;
  payload: NotificationPayload;
  read: boolean;
  createdAt: string;
}

// Every variant carries only pre-resolved, already-safe-to-see display
// data (never a raw DB row, never an internal id the recipient could use
// to query something they don't own) — the same discipline
// community-chat's SAFE_AUTHOR_SELECT applies to cross-user projections.
export type NotificationPayload =
  | {
      partnerId: string;
      partnerName: string;
      partnerAvatarUrl: string | null;
      invitationId: string;
    }
  | {
      partnerId: string;
      partnerName: string;
      partnerAvatarUrl: string | null;
      streakId: string;
    }
  | {
      partnerId: string;
      partnerName: string;
      partnerAvatarUrl: string | null;
      streakId: string;
      days: number;
    };

export interface ListNotificationsResult {
  data: NotificationDto[];
  meta: { hasMore: boolean; oldestId: string | null };
}
