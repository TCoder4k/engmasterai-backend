import type { SubscriptionPlan } from '@prisma/client';

// Payment.status (the DB enum) is PENDING | PAID | CANCELLED | REFUNDED —
// there is deliberately no persisted EXPIRED value (see schema.prisma's
// Payment model comment). This wider type is the PRESENTATION-layer status
// PaymentService.toDto derives at read time; EXPIRED only ever appears here,
// never in the database.
export type PaymentPresentationStatus =
  | 'PENDING'
  | 'PAID'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'REFUNDED';

export interface PaymentPresentationDto {
  paymentId: string;
  plan: SubscriptionPlan;
  amount: number;
  currency: string;
  paymentCode: string;
  status: PaymentPresentationStatus;
  expiresAt: string;
  bank: {
    code: string;
    accountNumber: string;
    accountName: string;
  };
  qrUrl: string;
}

export interface CreatePaymentResult {
  dto: PaymentPresentationDto;
  /** Whether a brand-new row was created (201) vs an existing live order was reused (200). */
  created: boolean;
}
