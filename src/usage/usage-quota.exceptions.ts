import { HttpException, HttpStatus } from '@nestjs/common';
import { UsageKind } from './usage-quota.types';

// Durable-for-the-period denial (identical to VocabWordLimitReachedException's
// reasoning — retrying the identical request cannot succeed until the next
// calendar period) — 403, not 429/409. Carries a stable `code` the frontend
// switches on to show an upgrade nudge instead of a generic error, same
// convention as CHAT_REPLY_IN_PROGRESS / VOCAB_WORD_LIMIT_REACHED.
export class UsageQuotaExceededException extends HttpException {
  constructor(kind: UsageKind, used: number, limit: number, isPro: boolean) {
    super(
      {
        statusCode: HttpStatus.FORBIDDEN,
        code: 'USAGE_QUOTA_EXCEEDED',
        kind,
        used,
        limit,
        message: isPro
          ? `You've used all ${limit} of your PRO ${kind} allowance for this period.`
          : `You've used all ${limit} of your Free ${kind} allowance for this period. Upgrade to PRO for a much higher limit.`,
      },
      HttpStatus.FORBIDDEN,
    );
  }
}
