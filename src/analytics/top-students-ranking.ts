import { PrismaService } from '../prisma/prisma.service';

// Shared by AdminDashboardAnalyticsService (which keeps `email` in its own
// response DTO) and DashboardAnalyticsService's student-facing leaderboard
// (which strips it before returning) — one ranking query, two privacy scopes
// layered on top, rather than two copies of this query drifting apart.
export const TOP_STUDENTS_LIMIT = 5;

export interface RankedStudent {
  id: string;
  name: string;
  email: string;
  level: number;
  totalStudySeconds: number;
  completedTasks: number;
}

// All-time SUM(creditedSeconds) per user, ranked. Tie-broken by userId asc so
// the top N is deterministic across loads even when totals are equal (small
// data sets like the current dev DB hit this often).
export async function rankTopStudents(prisma: PrismaService, limit: number): Promise<RankedStudent[]> {
  const grouped = await prisma.studyTimeEvent.groupBy({
    by: ['userId'],
    _sum: { creditedSeconds: true },
  });

  const ranked = grouped
    .map((group) => ({
      userId: group.userId,
      totalSeconds: group._sum.creditedSeconds ?? 0,
    }))
    .sort((a, b) => b.totalSeconds - a.totalSeconds || a.userId.localeCompare(b.userId))
    .slice(0, limit);

  if (ranked.length === 0) return [];

  const topIds = ranked.map((entry) => entry.userId);

  const [users, taskCompletions] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: topIds } },
      select: { id: true, name: true, email: true, level: true },
    }),
    prisma.lessonTaskProgress.groupBy({
      by: ['userId'],
      where: { userId: { in: topIds }, completedAt: { not: null } },
      _count: true,
    }),
  ]);

  const usersById = new Map(users.map((user) => [user.id, user]));
  const completedById = new Map(taskCompletions.map((group) => [group.userId, group._count]));

  const result: RankedStudent[] = [];
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
