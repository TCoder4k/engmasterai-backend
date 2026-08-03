import { StudyActivityType } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MAX_FLUSH_SECONDS, MAX_SEQUENCE } from '../study-time.constants';

// Sprint 10.5 — POST /study-time/heartbeat.
//
// WHAT IS ABSENT MATTERS MORE THAN WHAT IS PRESENT.
//
// There is no `occurredAt`, no `totalSecondsToday`, no `percent` and no `xp`.
// The server stamps its own clock and derives its own totals, so "the client
// told us it was 9pm yesterday" and "the client told us it had studied four
// hours" are not bugs that can be written — they are shapes that do not exist.
// Same rule Sprint 10 applied to XP amounts.
//
// NOTE ON THE GLOBAL PIPE: main.ts constructs `new ValidationPipe()` bare — no
// `whitelist`, no `forbidNonWhitelisted`. Unknown properties therefore survive
// on req.body rather than being stripped. The guarantee above comes from the
// service reading ONLY the fields declared here, not from the pipe removing
// anything. Tightening the global pipe affects every endpoint in the app and
// belongs to the cleanup sprint, not to this one.
export class StudyHeartbeatDto {
  /**
   * One per browser tab per boot, rotated when `sequence` reaches MAX_SEQUENCE.
   *
   * Half of the idempotency key. Not a security boundary — the user id always
   * comes from the verified token — but it is what makes a retried heartbeat
   * free and a replayed one worthless.
   */
  @IsUUID('4')
  clientSessionId!: string;

  /** Monotonic within a session, from 0. The other half of the idempotency key. */
  @IsInt()
  @Min(0)
  @Max(MAX_SEQUENCE)
  sequence!: number;

  /** Analytics dimension only. Nothing branches on it. */
  @IsEnum(StudyActivityType)
  activityType!: StudyActivityType;

  /**
   * The lesson/deck/listening-lesson the student was on, when there is one.
   *
   * NOT validated against visibility, and not trusted — see the note on
   * StudyTimeEvent.activityId in schema.prisma.
   *
   * A BOUNDED STRING RATHER THAN A UUID, deliberately. The first draft used
   * @IsUUID('4') and it was wrong about the product: Listening lessons are
   * client-seeded content whose ids are slugs (`office-relocation-notice`,
   * see listeningContent.ts), so every Listening heartbeat would have been a
   * 400 and that module would have contributed zero minutes — silently, since
   * a heartbeat has no UI. Listening being invisible to analytics is the exact
   * complaint Sprint 09 left open and this sprint set out to fix.
   *
   * UUID-shape validation bought nothing anyway: the value is untrusted by
   * design and gates nothing, so the only job left is keeping the column to a
   * sane size.
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  activityId?: string;

  /**
   * Active seconds the client accumulated since its last successful flush.
   *
   * An upper bound on what may be ASKED for. What is actually granted is
   * decided by creditableSeconds() against real elapsed time.
   */
  @IsInt()
  @Min(1)
  @Max(MAX_FLUSH_SECONDS)
  activeSeconds!: number;
}
