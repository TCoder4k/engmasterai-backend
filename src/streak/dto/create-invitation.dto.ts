import { IsUUID } from 'class-validator';

export class CreateInvitationDto {
  // The only "other user" field on this DTO — identity of the SENDER always
  // comes from the authenticated request (req.user.userId), never the body,
  // same discipline as community-chat's SendCommunityMessageDto.
  @IsUUID('4')
  inviteeId!: string;
}
