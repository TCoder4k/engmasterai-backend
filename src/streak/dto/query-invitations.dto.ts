import { IsIn, IsOptional } from 'class-validator';
import { StreakInvitationStatus } from '@prisma/client';

export class QueryInvitationsDto {
  @IsOptional()
  @IsIn(['sent', 'received'])
  direction?: 'sent' | 'received';

  @IsOptional()
  @IsIn(Object.values(StreakInvitationStatus))
  status?: StreakInvitationStatus;
}
