import { IsEnum } from 'class-validator';
import { SubscriptionPlan } from '@prisma/client';

// Deliberately the ONLY field. The frontend must never be able to choose a
// price — PaymentService.PLAN_PRICES is the sole source of the amount, keyed
// off this enum value alone.
export class CreatePaymentDto {
  @IsEnum(SubscriptionPlan)
  plan: SubscriptionPlan;
}
