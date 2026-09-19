import { IsString, Length } from 'class-validator';

export class RedeemReferralDto {
  @IsString()
  @Length(1, 64)
  code: string;
}
