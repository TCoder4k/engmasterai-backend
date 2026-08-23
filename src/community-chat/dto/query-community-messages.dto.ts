import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export const DEFAULT_COMMUNITY_MESSAGES_LIMIT = 40;
export const MAX_COMMUNITY_MESSAGES_LIMIT = 50;

// Cursor pagination, not this codebase's usual {page,limit} shape — a
// live-appending feed has no stable "page N", and "load older on scroll up"
// is exactly what a cursor fits. `before` is a message id (not a raw
// timestamp) so a same-millisecond boundary can never duplicate/skip a row
// — see CommunityChatService.listMessages.
export class QueryCommunityMessagesDto {
  @IsOptional()
  @IsUUID('4')
  before?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_COMMUNITY_MESSAGES_LIMIT)
  limit?: number;
}
