import { IsIn, IsOptional, IsString } from 'class-validator';

export class RevokeSubscriptionDto {
  @IsIn(['PRO', 'HOC_TAP'])
  plan!: 'PRO' | 'HOC_TAP';

  @IsString()
  @IsOptional()
  reason?: string;
}
