import { SetMetadata } from '@nestjs/common';

// Notification's own independent rate-limit namespace — must never share a
// bucket with community:/streak:/etc. Only `read`/`write` are needed: this
// module has no expensive fan-out action like community-chat's `send`.
export type NotificationRateLimitKind = 'read' | 'write';

export interface NotificationRateLimitPolicy {
  kind: NotificationRateLimitKind;
  max: number;
  windowSeconds: number;
}

export const NOTIFICATION_RATE_LIMITS_KEY = 'notification_rate_limit';

export const NotificationRateLimit = (policy: NotificationRateLimitPolicy) =>
  SetMetadata(NOTIFICATION_RATE_LIMITS_KEY, policy);
