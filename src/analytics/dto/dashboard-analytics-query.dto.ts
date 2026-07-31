import { IsOptional, IsTimeZone } from 'class-validator';

// Sprint 09 — the query of GET /analytics/dashboard.
export class DashboardAnalyticsQueryDto {
  /**
   * The caller's IANA timezone, e.g. from
   * `Intl.DateTimeFormat().resolvedOptions().timeZone`.
   *
   * `@IsTimeZone()` is a HARD REQUIREMENT, not tidiness. The value reaches
   * `Intl.DateTimeFormat({ timeZone })` in timezone.util.ts, which throws
   * RangeError on an unknown zone — without this decorator `?tz=Not/AZone`
   * is a 500 handed to any anonymous-ish caller. The app-wide ValidationPipe
   * (main.ts) is constructed bare, with no `whitelist`, so nothing else in the
   * stack would stop it.
   *
   * UNLIKE the SRS queue's `tz`, this one WINS over the stored User.timezone
   * for the purpose of this read — see DashboardAnalyticsService.
   */
  @IsTimeZone()
  @IsOptional()
  tz?: string;
}
