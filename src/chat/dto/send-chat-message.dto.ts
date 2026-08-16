import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { LESSON_CONTEXT_STAGES } from '../chat-context.types';

// The approved plan's contract: 1-2000 chars, trimmed before validation runs
// (an all-whitespace message fails @Length(1,...) honestly instead of
// passing through as "non-empty").
export const MAX_CHAT_MESSAGE_LENGTH = 2000;

// Phase C — LESSON/VOCAB_WORD joined GENERAL. The server re-resolves and
// re-authorizes `resourceId` from scratch via ChatContextResolver either
// way (assertLessonVisible's anti-probing 404, or a plain VocabWord lookup)
// — this DTO only validates that the SHAPE makes sense, never trusts the
// content described by these fields.
class ChatContextDto {
  @IsIn(['GENERAL', 'LESSON', 'VOCAB_WORD'])
  type!: 'GENERAL' | 'LESSON' | 'VOCAB_WORD';

  // Required for LESSON/VOCAB_WORD, absent for GENERAL.
  @ValidateIf((o: ChatContextDto) => o.type !== 'GENERAL')
  @IsUUID('4')
  resourceId?: string;

  // Descriptive only — mirrors LessonPage's current `?stage=`. NEVER used
  // for access control (assessment integrity is Placement-Attempt-only,
  // see AssessmentLockService); it only changes which lesson fields
  // chat-context.resolver.ts considers safe to include. Meaningless outside
  // type:'LESSON', where the resolver simply never reads it.
  @IsOptional()
  @IsIn(LESSON_CONTEXT_STAGES)
  stage?: (typeof LESSON_CONTEXT_STAGES)[number];
}

export class SendChatMessageDto {
  // Generated client-side, once per logical outgoing message, and REUSED on
  // retry (see docs/CLAUDE.md's Phase B client lifecycle notes) — this is
  // the whole idempotency key; the server never invents its own.
  @IsUUID('4')
  clientMessageId!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, MAX_CHAT_MESSAGE_LENGTH)
  message!: string;

  // Optional; omitting it is the same as {type:'GENERAL'} (see
  // chat.controller.ts).
  @IsOptional()
  @ValidateNested()
  @Type(() => ChatContextDto)
  context?: ChatContextDto;
}
