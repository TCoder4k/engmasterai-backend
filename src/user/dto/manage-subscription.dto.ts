import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class ManageSubscriptionDto {
  @IsIn(['PRO', 'HOC_TAP'])
  plan!: 'PRO' | 'HOC_TAP';

  @IsInt()
  @Min(1)
  durationDays!: number;

  @IsString()
  @IsOptional()
  reason?: string;
}
