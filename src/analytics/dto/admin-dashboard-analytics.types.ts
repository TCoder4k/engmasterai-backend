// GET /analytics/admin-dashboard — the admin-wide sibling of
// GET /analytics/dashboard. That endpoint answers "what did THIS student do";
// this one answers "what is happening across every student", so it is a
// separate service/controller rather than a mode flag on the per-user one —
// see admin-dashboard-analytics.service.ts's header for the full reasoning.
//
// SAME DISCIPLINE AS THE PER-USER DTO: a number that cannot be honestly
// computed from existing rows is `null`, never a fabricated 0 or sample
// value. Two null categories exist here and they mean different things —
// each field below says which:
//
//   - "no signal exists at all" (userGrowth.decreasedLast30d/
//     retentionRatePercent) — there is no lastLoginAt/deletedAt column
//     anywhere on User, so this is permanently null until that data exists.
//   - "no data in this window" (passRatePercent and its change) — 0 would
//     falsely claim "attempted and failed everything"; null honestly says
//     "nobody submitted anything in this window".

export interface AdminSummaryDto {
  /** COUNT(User WHERE role = USER) — deliberately excludes ADMIN accounts,
   *  unlike the existing GET /users total, which does not filter role. */
  totalStudents: number;
  /** COUNT(Course), every course including drafts — same radius as the
   *  existing admin course list. */
  totalCourses: number;

  /** Average of the 7 daily distinct-active-user counts in `engagement`.
   *  "Active" = has a StudyTimeEvent OR a completed SpeakingAttempt that
   *  day — Speaking never writes StudyTimeEvent, so both sources must be
   *  unioned or Speaking-only students would never count as active. Always
   *  a real number, never null. */
  dauAvg7d: number;
  /** vs. the 7 days immediately before this window. null when the previous
   *  window's average was 0 — there is no percentage change from nothing. */
  dauAvg7dChangePercent: number | null;

  /** passed / submitted * 100 across LessonTaskAttempt in this window,
   *  published tasks only (same `publishedTask` scope the per-user
   *  dashboard's recentAccuracyPercent uses). null when nobody submitted an
   *  attempt in the window — see the module header on why this is not 0. */
  passRatePercent: number | null;
  /** null unless BOTH this window and the previous one have at least one
   *  submitted attempt — comparing against "no data" is not a percentage. */
  passRatePercentChangePercent: number | null;

  /** COUNT(SpeakingAttempt WHERE completedAt in window) — one row per
   *  finished conversation. Deliberately NOT called "AI API calls": Gemini
   *  Live is one persistent WebSocket per attempt, not one request per turn,
   *  and Engy Chat has no persisted history at all (Redis, 30-minute TTL, no
   *  Prisma model) so it cannot be counted here. This is Speaking Partner
   *  usage only. */
  aiSessions7d: number;
  aiSessions7dChangePercent: number | null;

  /** SUM(SpeakingAttempt.turnCount) in window — total conversational turns
   *  exchanged, a finer-grained number than aiSessions7d. Same Speaking-only
   *  scope and caveat as above. */
  aiTurns7d: number;
  aiTurns7dChangePercent: number | null;
}

export interface AdminEngagementPointDto {
  /** 'YYYY-MM-DD', UTC — there is no single timezone for a cross-student
   *  aggregate, unlike the per-user dashboard which buckets on the
   *  student's own `tz`. */
  date: string;
  activeUsers: number;
  /** LessonTaskProgress + LessonStepProgress completions that day, published
   *  scope only. This counts STAGE-completion events (a single lesson can
   *  produce several — video, theory, quiz, practice), not lessons or
   *  scenarios finished — the frontend label must say "learning activities
   *  completed", not "lessons/scenarios completed". */
  completedActivities: number;
}

export interface AdminUserGrowthDailyPointDto {
  date: string;
  /** Running total of students (role=USER) that existed by the end of this
   *  day — a cumulative count, not a per-day new-signup count. */
  totalStudents: number;
}

export interface AdminUserGrowthDto {
  totalStudents: number;
  newLast30d: number;
  /** Permanently null — see this file's header. Rendered as "Sắp có" in the
   *  UI, not blurred/overlaid like the KPI-row ComingSoon treatment (this is
   *  one small stat, not a whole widget with no real content). */
  decreasedLast30d: null;
  retentionRatePercent: null;
  dailyCumulative: AdminUserGrowthDailyPointDto[];
}

export type AdminSkillType = 'LISTENING' | 'SPEAKING' | 'VOCAB_GRAMMAR';

export interface AdminSkillBreakdownDto {
  type: AdminSkillType;
  /** Session count, NOT time — the one unit all three skills can share
   *  honestly. Listening/Vocab-Grammar: DISTINCT StudyTimeEvent
   *  clientSessionId in the window. Speaking: COUNT(SpeakingAttempt), which
   *  is already one row per session — Speaking has no StudyTimeEvent rows to
   *  count instead (see AdminSummaryDto.aiSessions7d). Mixing minutes for
   *  two skills with a raw row-count for the third would look real while
   *  silently misrepresenting proportion, so every bucket uses the same
   *  "sessions" unit instead. */
  sessionCount: number;
}

export interface AdminTopStudentDto {
  id: string;
  name: string;
  email: string;
  level: number;
  /** SUM(StudyTimeEvent.creditedSeconds), all time. */
  totalStudySeconds: number;
  /** COUNT(LessonTaskProgress WHERE completedAt IS NOT NULL) — task-level,
   *  not lesson-level (a lesson completion requires the full stage-derivation
   *  invariant in lesson-status.ts, too expensive to run per top-5 row for
   *  what is meant to be a lightweight ranking widget). Labelled "Bài tập
   *  hoàn thành" in the UI, not "Bài học hoàn thành". */
  completedTasks: number;
}

export interface AdminDashboardAnalyticsDto {
  summary: AdminSummaryDto;
  /** Ascending, exactly 7 entries, last element is today (UTC). */
  engagement: AdminEngagementPointDto[];
  userGrowth: AdminUserGrowthDto;
  /** Always exactly 3 entries: LISTENING, SPEAKING, VOCAB_GRAMMAR. */
  skills: AdminSkillBreakdownDto[];
  /** Up to 5, ranked by totalStudySeconds desc, userId asc as a
   *  deterministic tie-breaker. */
  topStudents: AdminTopStudentDto[];
}
