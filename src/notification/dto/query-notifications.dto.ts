import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { MAX_NOTIFICATIONS_LIMIT } from '../notification.service';

export class QueryNotificationsDto {
  @IsOptional()
  @IsUUID('4')
  before?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_NOTIFICATIONS_LIMIT)
  limit?: number;
}
