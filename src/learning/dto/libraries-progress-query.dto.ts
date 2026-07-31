import { IsOptional, IsTimeZone } from 'class-validator';

// Sprint 09 follow-up — the query of GET /learning/libraries/progress.
export class LibrariesProgressQueryDto {
  /**
   * The caller's IANA timezone, used only to bucket "today" when counting how
   * much of the daily new-word quota is already spent.
   *
   * `@IsTimeZone()` is required, not tidiness: the value reaches
   * `Intl.DateTimeFormat({ timeZone })` in timezone.util.ts, which throws
   * RangeError on an unknown zone, and the app-wide ValidationPipe is
   * constructed bare with no `whitelist`.
   *
   * READ-ONLY. Unlike the due-queue's `tz`, this one never bootstraps
   * User.timezone — see LearningService.countNewWordsIntroducedToday.
   */
  @IsTimeZone()
  @IsOptional()
  tz?: string;
}
