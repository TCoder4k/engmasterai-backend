import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

// SePay's documented incoming-transaction webhook payload
// (docs.sepay.vn/tich-hop-webhooks.html, developer.sepay.vn/en/sepay-webhooks).
// Only the fields PaymentService actually reads are validated strictly — the
// app-wide ValidationPipe has no `whitelist`, so any other field SePay sends
// simply passes through unused rather than being rejected.
export class SepayWebhookDto {
  // SePay's own transaction id — the durable idempotency key persisted as
  // Payment.providerTransactionId (stored as a string via String(dto.id),
  // since the Prisma column is String? @unique).
  @IsInt()
  id: number;

  @IsString()
  @IsOptional()
  gateway?: string;

  @IsString()
  @IsOptional()
  transactionDate?: string;

  @IsString()
  @IsOptional()
  accountNumber?: string;

  @IsString()
  @IsOptional()
  subAccount?: string;

  // SePay's own best-effort extraction of a reference code from `content` —
  // NEVER trusted for matching (documented as unreliable extraction).
  // PaymentService parses `content` directly instead; this is kept only for
  // logging/triage.
  @IsString()
  @IsOptional()
  code?: string;

  // The raw transfer description — what PaymentService actually searches for
  // the embedded ENG######## payment code.
  @IsString()
  @IsNotEmpty()
  content: string;

  // "in" = incoming transfer, the only kind that can ever settle a payment.
  // "out" is ignored (200, not an error) — see PaymentService.processSepayWebhook.
  @IsIn(['in', 'out'])
  transferType: 'in' | 'out';

  @IsString()
  @IsOptional()
  description?: string;

  @IsInt()
  @Min(0)
  transferAmount: number;

  @IsInt()
  @IsOptional()
  accumulated?: number;

  @IsString()
  @IsOptional()
  referenceCode?: string;
}
