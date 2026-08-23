import { Transform } from 'class-transformer';
import { IsString, IsUUID, Length } from 'class-validator';

// 500, not Engy's 2000: this is rapid-fire public chat, not a considered Q&A
// prompt — comfortably fits several sentences or a shared link while making
// a wall-of-text spam message impossible. DTO-level only, matching this
// schema's convention of no @db.VarChar anywhere.
export const MAX_COMMUNITY_MESSAGE_LENGTH = 500;

export class SendCommunityMessageDto {
  // Generated client-side, once per logical outgoing message, and REUSED on
  // retry — same convention as ChatModule's SendChatMessageDto. This is the
  // whole idempotency key; the server never invents its own. There is
  // deliberately no `userId` field anywhere on this DTO — identity always
  // comes from the authenticated request, never the body.
  @IsUUID('4')
  clientMessageId!: string;

  // Trim BEFORE @Length runs, so an all-whitespace message fails validation
  // honestly instead of passing through as "non-empty" — same order
  // SendChatMessageDto.message uses.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, MAX_COMMUNITY_MESSAGE_LENGTH)
  content!: string;
}
