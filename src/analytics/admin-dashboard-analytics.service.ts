import { Injectable } from '@nestjs/common';
import { StudyActivityType, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { publishedLesson, publishedTask } from '../shared/published-scope';
import { startOfDayInTimeZone } from '../learning/timezone.util';
import { enumerateDaysInTimeZone, formatDayInTimeZone } from './day-window';
import {
  AdminDashboardAnalyticsDto,
  AdminEngagementPointDto,
  AdminSkillBreakdownDto,
  AdminSummaryDto,
  AdminTopStudentDto,
  AdminUserGrowthDto,
} from './dto/admin-dashboard-analytics.types';

// GET /analytics/admin-dashboard's aggregation layer.
//
// WHY A SEPARATE SERVICE FROM DashboardAnalyticsService, not a mode on it.
// That service is deliberately scoped to exactly one user (its own header
// documents an "11 constant reads" cost that does NOT grow with how much the
// student has studied). Every read here is the opposite shape — an aggregate
// across every user — so bolting it on would turn a bounded-cost service into
// one whose cost model depends on which method you call. Two services, two
// cost models, each easy to reason about on its own.
//
// UTC, NOT PER-USER TIMEZONE. The per-user dashboard buckets on the
// student's own `tz`/`User.timezone` because "today" is a meaningful,
// personal boundary for streaks and daily quotas. There is no single
// timezone for an aggregate across every student, so every day boundary here
// is UTC — a deliberate, simpler choice, not an oversight.
//
// WINDOW MATH — see enumerateDaysInTimeZone/startOfDayInTimeZone. `now` is
// computed exactly once per request and threaded through every helper below;
// nothing here calls `new Date()` a second time. Every window is half-open
// [start, end) and the 7-day window's START is snapped to the beginning of
// its first calendar day (mirroring DashboardAnalyticsService's own
// `windowStart` construction) rather than a raw `now - 7*24h` instant — that
// matters because a raw instant offset does not land on a UTC day boundary,
// which would silently split one calendar day's rows across two buckets (or
// drop the overflow entirely) once rows are grouped by calendar day below.
//
// QUERY COST — deliberately not optimized with $queryRaw/date_trunc yet.
// Every per-day bucketing here pulls the window's raw rows into JS and groups
// them with formatDayInTimeZone, the same style DashboardAnalyticsService
// uses for its own activity calendar. At the current/foreseeable data scale
// (an admin-only, rarely-loaded read) this is cheap; if the row volume ever
// makes it not cheap, the fix is server-side GROUP BY date_trunc('day', ...),
// not a rewrite of the metric definitions below.
const UTC = 'UTC';
const ENGAGEMENT_WINDOW_DAYS = 7;
const GROWTH_WINDOW_DAYS = 30;
const TOP_STUDENTS_LIMIT = 5;

// Everything StudyTimeEvent can see that is not Listening. Grammar-lesson
// stages (VIDEO/THEORY/QUIZ/PRACTICE/TRAP_HUNTER) and vocabulary
// (SRS_REVIEW/VOCAB_PRACTICE) are bucketed together as "Từ vựng & Ngữ pháp",
// matching the mockup's own grouping. There is no SPEAKING value in this
// enum — confirmed by grep against prisma/schema.prisma AND against every
// `useStudyActivity(` call site in the frontend, none of which is a Speaking
// page — so Speaking's skill-breakdown bucket is sourced from SpeakingAttempt
// instead, below.
const VOCAB_GRAMMAR_ACTIVITY_TYPES: StudyActivityType[] = [
  StudyActivityType.VIDEO,
  StudyActivityType.THEORY,
  StudyActivityType.QUIZ,
  StudyActivityType.PRACTICE,
  StudyActivityType.TRAP_HUNTER,
  StudyActivityType.SRS_REVIEW,
  StudyActivityType.VOCAB_PRACTICE,
];

interface PassedGroup {
  passed: boolean;
  _count: number;
}

// Exported (not just module-private) so these can be unit-tested directly —
// they carry the most bug-prone, precisely-specified rules in this file (the
// null-vs-zero distinctions), and testing them as pure functions is far
// cheaper and more exhaustive than driving every case through a mocked
// PrismaService. See admin-dashboard-analytics.service.spec.ts.

/** previous <= 0 → null, never Infinity/NaN from a zero or negative baseline. */
export function computeChangePercent(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export function average(values: number[]): number {
  if (values.length === 0) return 0;
  const sum = values.reduce((total, value) => total + value, 0);
  return Math.round((sum / values.length) * 10) / 10;
}

/** null when nobody submitted anything — see the DTO header on why that is
 *  not the same as a real 0%. */
export function passRateFromGroups(groups: PassedGroup[]): number | null {
  const total = groups.reduce((sum, group) => sum + group._count, 0);
  if (total === 0) return null;
  const passed = groups.find((group) => group.passed)?._count ?? 0;
  return Math.round((passed / total) * 1000) / 10;
}

@Injectable()
export class AdminDashboardAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getAdminDashboardAnalytics(): Promise<AdminDashboardAnalyticsDto> {
    const now = new Date();

    const days7 = enumerateDaysInTimeZone(now, UTC, ENGAGEMENT_WINDOW_DAYS);
    const current7dStart = startOfDayInTimeZone(
      new Date(`${days7[0]}T12:00:00.000Z`),
      UTC,
    );
    const current7dEnd = now;

    const days7prev = enumerateDaysInTimeZone(
      new Date(current7dStart.getTime() - 1),
      UTC,
      ENGAGEMENT_WINDOW_DAYS,
    );
    const previous7dStart = startOfDayInTimeZone(
      new Date(`${days7prev[0]}T12:00:00.000Z`),
      UTC,
    );
    const previous7dEnd = current7dStart;

    const days30 = enumerateDaysInTimeZone(now, UTC, GROWTH_WINDOW_DAYS);
    const window30dStart = startOfDayInTimeZone(
      new Date(`${days30[0]}T12:00:00.000Z`),
      UTC,
    );

    const [
      totalCourses,
      currentActiveByDay,
      previousActiveByDay,
      currentCompletedByDay,
      currentAttemptGroups,
      previousAttemptGroups,
      currentAiAgg,
      previousAiAgg,
      skills,
      userGrowth,
      topStudents,
    ] = await Promise.all([
      this.prisma.course.count(),
      this.computeDailyActiveUsers(days7, current7dStart, current7dEnd),
      this.computeDailyActiveUsers(days7prev, previous7dStart, previous7dEnd),
      this.computeDailyCompletedActivities(days7, current7dStart, current7dEnd),
      this.prisma.lessonTaskAttempt.groupBy({
        by: ['passed'],
        where: { submittedAt: { gte: current7dStart, lt: current7dEnd }, task: publishedTask },
        _count: true,
      }),
      this.prisma.lessonTaskAttempt.groupBy({
        by: ['passed'],
        where: { submittedAt: { gte: previous7dStart, lt: previous7dEnd }, task: publishedTask },
        _count: true,
      }),
      this.prisma.speakingAttempt.aggregate({
        where: { completedAt: { gte: current7dStart, lt: current7dEnd } },
        _count: true,
        _sum: { turnCount: true },
      }),
      this.prisma.speakingAttempt.aggregate({
        where: { completedAt: { gte: previous7dStart, lt: previous7dEnd } },
        _count: true,
        _sum: { turnCount: true },
      }),
      this.getSkillBreakdown(current7dStart, current7dEnd),
      this.getUserGrowth(now, days30, window30dStart),
      this.getTopStudents(),
    ]);

    const engagement: AdminEngagementPointDto[] = days7.map((day) => ({
      date: day,
      activeUsers: currentActiveByDay.get(day)?.size ?? 0,
      completedActivities: currentCompletedByDay.get(day) ?? 0,
    }));

    const dauAvg7d = average(engagement.map((point) => point.activeUsers));
    const dauAvgPrevious7d = average(
      days7prev.map((day) => previousActiveByDay.get(day)?.size ?? 0),
    );

    const passRatePercent = passRateFromGroups(currentAttemptGroups);
    const passRatePreviousPercent = passRateFromGroups(previousAttemptGroups);

    const currentAi = currentAiAgg;
    const previousAi = previousAiAgg;

    const summary: AdminSummaryDto = {
      totalStudents: userGrowth.totalStudents,
      totalCourses,
      dauAvg7d,
      dauAvg7dChangePercent: computeChangePercent(dauAvg7d, dauAvgPrevious7d),
      passRatePercent,
      passRatePercentChangePercent:
        passRatePercent !== null && passRatePreviousPercent !== null
          ? computeChangePercent(passRatePercent, passRatePreviousPercent)
          : null,
      aiSessions7d: currentAi._count,
      aiSessions7dChangePercent: computeChangePercent(currentAi._count, previousAi._count),
      aiTurns7d: currentAi._sum.turnCount ?? 0,
      aiTurns7dChangePercent: computeChangePercent(
        currentAi._sum.turnCount ?? 0,
        previousAi._sum.turnCount ?? 0,
      ),
    };

    return { summary, engagement, userGrowth, skills, topStudents };
  }

  // "Active" = wrote a StudyTimeEvent OR finished a SpeakingAttempt that day.
  // Speaking never writes StudyTimeEvent (confirmed by grep — no Speaking
  // page calls useStudyActivity), so a Speaking-only student would vanish
  // from DAU entirely without this union.
  private async computeDailyActiveUsers(
    days: string[],
    start: Date,
    end: Date,
  ): Promise<Map<string, Set<string>>> {
    const [studyRows, speakingRows] = await Promise.all([
      this.prisma.studyTimeEvent.findMany({
        where: { occurredAt: { gte: start, lt: end } },
        select: { userId: true, occurredAt: true },
      }),
      this.prisma.speakingAttempt.findMany({
        where: { completedAt: { gte: start, lt: end } },
        select: { userId: true, completedAt: true },
      }),
    ]);

    const byDay = new Map<string, Set<string>>();
    for (const day of days) byDay.set(day, new Set<string>());

    const add = (userId: string, instant: Date) => {
      const day = formatDayInTimeZone(instant, UTC);
      // A row outside `days` cannot happen given the query's own [start, end)
      // range and how `days`/`start` are derived from the same window, but
      // `.get` returning undefined here is handled defensively rather than
      // asserted, since a Map miss failing silently is safer than a 500 on a
      // dashboard read.
      byDay.get(day)?.add(userId);
    };

    for (const row of studyRows) add(row.userId, row.occurredAt);
    for (const row of speakingRows) {
      if (row.completedAt) add(row.userId, row.completedAt);
    }

    return byDay;
  }

  // Stage-completion events, not lesson/scenario completions — see the DTO's
  // own comment on AdminEngagementPointDto.completedActivities. Published
  // scope only (publishedTask/publishedLesson), matching the precedent
  // DashboardAnalyticsService already sets for "completion counts" as
  // opposed to the activity calendar, which is deliberately unfiltered.
  private async computeDailyCompletedActivities(
    days: string[],
    start: Date,
    end: Date,
  ): Promise<Map<string, number>> {
    const [taskRows, stepRows] = await Promise.all([
      this.prisma.lessonTaskProgress.findMany({
        where: { completedAt: { gte: start, lt: end }, task: publishedTask },
        select: { completedAt: true },
      }),
      this.prisma.lessonStepProgress.findMany({
        where: { completedAt: { gte: start, lt: end }, lesson: publishedLesson },
        select: { completedAt: true },
      }),
    ]);

    const byDay = new Map<string, number>();
    for (const day of days) byDay.set(day, 0);

    const add = (instant: Date | null) => {
      if (!instant) return;
      const day = formatDayInTimeZone(instant, UTC);
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
    };

    for (const row of taskRows) add(row.completedAt);
    for (const row of stepRows) add(row.completedAt);

    return byDay;
  }

  // Session-count unit shared across all three buckets — see
  // AdminSkillBreakdownDto's own comment on why this matters (mixing minutes
  // for two skills with a raw attempt-count for the third would look real
  // while silently misrepresenting proportion).
  private async getSkillBreakdown(start: Date, end: Date): Promise<AdminSkillBreakdownDto[]> {
    const [listeningSessions, vocabGrammarSessions, speakingSessionCount] = await Promise.all([
      this.prisma.studyTimeEvent.findMany({
        where: { activityType: StudyActivityType.LISTENING, occurredAt: { gte: start, lt: end } },
        select: { clientSessionId: true },
        distinct: ['clientSessionId'],
      }),
      this.prisma.studyTimeEvent.findMany({
        where: {
          activityType: { in: VOCAB_GRAMMAR_ACTIVITY_TYPES },
          occurredAt: { gte: start, lt: end },
        },
        select: { clientSessionId: true },
        distinct: ['clientSessionId'],
      }),
      this.prisma.speakingAttempt.count({
        where: { completedAt: { gte: start, lt: end } },
      }),
    ]);

    return [
      { type: 'LISTENING', sessionCount: listeningSessions.length },
      { type: 'VOCAB_GRAMMAR', sessionCount: vocabGrammarSessions.length },
      { type: 'SPEAKING', sessionCount: speakingSessionCount },
    ];
  }

  // role: USER throughout — deliberately excludes ADMIN accounts from every
  // number here (totalStudents, newLast30d, dailyCumulative), unlike the
  // existing GET /users, which counts everyone. "User growth" is a product
  // question about students; admin accounts are provisioned manually and are
  // not a growth signal.
  //
  // dailyCumulative avoids pulling every User row ever created: `baseline` is
  // a single COUNT of users that already existed before the window, and only
  // the 30 days' worth of NEW rows are fetched — cost depends on how many
  // students joined in the last 30 days, not on the account's total history.
  private async getUserGrowth(
    now: Date,
    days30: string[],
    window30dStart: Date,
  ): Promise<AdminUserGrowthDto> {
    const [totalStudents, baselineCount, newRows] = await Promise.all([
      this.prisma.user.count({ where: { role: UserRole.USER } }),
      this.prisma.user.count({
        where: { role: UserRole.USER, createdAt: { lt: window30dStart } },
      }),
      this.prisma.user.findMany({
        where: { role: UserRole.USER, createdAt: { gte: window30dStart, lt: now } },
        select: { createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const newCountByDay = new Map<string, number>();
    for (const row of newRows) {
      const day = formatDayInTimeZone(row.createdAt, UTC);
      newCountByDay.set(day, (newCountByDay.get(day) ?? 0) + 1);
    }

    let running = baselineCount;
    const dailyCumulative = days30.map((day) => {
      running += newCountByDay.get(day) ?? 0;
      return { date: day, totalStudents: running };
    });

    return {
      totalStudents,
      newLast30d: newRows.length,
      // Permanently null — no lastLoginAt/deletedAt column exists anywhere on
      // User to compute churn/retention from. See this DTO file's header.
      decreasedLast30d: null,
      retentionRatePercent: null,
      dailyCumulative,
    };
  }

  // All-time SUM(creditedSeconds) per user, ranked. Tie-broken by userId asc
  // so the top 5 is deterministic across loads even when totals are equal
  // (small data sets like the current dev DB hit this often).
  private async getTopStudents(): Promise<AdminTopStudentDto[]> {
    const grouped = await this.prisma.studyTimeEvent.groupBy({
      by: ['userId'],
      _sum: { creditedSeconds: true },
    });

    const ranked = grouped
      .map((group) => ({
        userId: group.userId,
        totalSeconds: group._sum.creditedSeconds ?? 0,
      }))
      .sort((a, b) => b.totalSeconds - a.totalSeconds || a.userId.localeCompare(b.userId))
      .slice(0, TOP_STUDENTS_LIMIT);

    if (ranked.length === 0) return [];

    const topIds = ranked.map((entry) => entry.userId);

    const [users, taskCompletions] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: topIds } },
        select: { id: true, name: true, email: true, level: true },
      }),
      this.prisma.lessonTaskProgress.groupBy({
        by: ['userId'],
        where: { userId: { in: topIds }, completedAt: { not: null } },
        _count: true,
      }),
    ]);

    const usersById = new Map(users.map((user) => [user.id, user]));
    const completedById = new Map(
      taskCompletions.map((group) => [group.userId, group._count]),
    );

    const result: AdminTopStudentDto[] = [];
    for (const entry of ranked) {
      const user = usersById.get(entry.userId);
      // Defensive only: a user deleted between the two queries above. Skipped
      // rather than thrown, same "a stale id must not fail the whole read"
      // reasoning as filterAccessibleCourses elsewhere in this codebase.
      if (!user) continue;
      result.push({
        id: user.id,
        name: user.name,
        email: user.email,
        level: user.level,
        totalStudySeconds: entry.totalSeconds,
        completedTasks: completedById.get(entry.userId) ?? 0,
      });
    }
    return result;
  }
}
