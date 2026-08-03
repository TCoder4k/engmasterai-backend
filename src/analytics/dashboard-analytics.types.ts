// Sprint 09 — GET /analytics/dashboard.
//
// The dashboard's ONE analytics read. Sprint 07 made progress server-side and
// Sprint 08 made the completion RULE server-side, but both answer "what is the
// state NOW", keyed by (user, lesson/course). Nothing answered "what happened
// in a time window", which is why four dashboard widgets were still hardcoded
// sample data. This is that missing layer, derived entirely from rows the
// learning engines already write — no new write path, no second source of
// truth, nothing to backfill.

export interface TodayTaskAttemptsDto {
  quiz: number;
  practice: number;
  total: number;
}

export interface TodayAnalyticsDto {
  /** 'YYYY-MM-DD' in effectiveTimeZone — the day every count below covers. */
  date: string;

  // MODULE-AGNOSTIC BY DEFINITION, and that is what keeps this DTO stable as
  // the product grows. `stagesCompleted` is "learning stages finished today,
  // across EVERY module" — not "Grammar stages". When Writing and Speaking
  // land, they add a SOURCE to the sum; they do not add a field here and they
  // do not require a frontend change.
  //
  // Same spirit as Invariant A in lesson-status.ts: the rule grows by gaining
  // an entry in a list, never by being rewritten.
  stagesCompleted: number;

  /**
   * Attempts SUBMITTED today, not attempts passed — a student who tried twice
   * and failed twice did real work, and a dashboard that reports 0 for it is
   * discouraging and wrong.
   */
  taskAttempts: TodayTaskAttemptsDto;

  /** Words that entered this user's vocabulary today (first ever rating). */
  newWordsLearned: number;

  /** SRS reviews submitted today, including repeats of the same word. */
  wordsReviewed: number;

  /**
   * Server-credited ACTIVE study seconds today (Sprint 10.5).
   *
   * Seconds, not minutes: the client floors to whole minutes for display, and
   * rounding on the server would make two different widgets disagree about the
   * same figure the moment a second one wants it.
   *
   * This is time the student was demonstrably working — a visible tab, a
   * registered learning activity, and either recent interaction or playing
   * media. Idle time, hidden tabs and duplicate tabs contribute nothing, and a
   * per-day convergence ceiling stops concurrent devices multiplying it. It is
   * NOT page-open time, and it must never be presented as such.
   *
   * 0 is a real answer for a student who has not studied today. The widget's
   * loading and error states are separate, and neither may render as 0.
   */
  activeStudySeconds: number;
}

export interface ActivityDayDto {
  /** 'YYYY-MM-DD' in effectiveTimeZone. */
  date: string;
  active: boolean;
}

export interface ActivityAnalyticsDto {
  windowDays: number;
  /** Ascending, exactly `windowDays` long, last element is today. */
  days: ActivityDayDto[];
  /**
   * Consecutive active days counting back from today.
   *
   * If today is still empty but yesterday was active, the streak counts from
   * yesterday and is NOT broken — an evening learner must not see 0 every
   * morning. A streak breaks only once a whole day has passed with nothing in
   * it. See countCurrentStreak in day-window.ts.
   */
  currentStreakDays: number;
  /**
   * True when every day in the window is active, i.e. the real streak may be
   * longer than this window can see. The client renders "7+" rather than "7".
   * Honest truncation: a longer look-back is a rollup table's job, not a
   * 9,000-row scan on every dashboard load.
   */
  streakCapped: boolean;
}

export interface DashboardAnalyticsDto {
  /**
   * The timezone actually used to bucket every day above — the request's `tz`
   * when supplied, else the stored User.timezone, else UTC. Returned so a
   * "why does today look wrong" report can be diagnosed from the response
   * alone, without guessing what the server assumed.
   */
  effectiveTimeZone: string;
  today: TodayAnalyticsDto;
  activity: ActivityAnalyticsDto;
}
