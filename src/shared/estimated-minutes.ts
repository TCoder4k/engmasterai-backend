// Sprint (Dashboard redesign) — the ONE definition of "how many minutes of
// published lesson content does this course have", shared by the two
// features that ask it: CourseService's course-card tile ("12 bài · 340
// phút") and PlacementService's roadmap phase duration estimate.
//
// WHY IT LIVES HERE RATHER THAN ON CourseService. Exporting it from there
// would force PlacementModule to import CourseModule for a groupBy — coupling
// two modules so one can borrow a query. study-time-window.ts and
// activity-window.ts already established the alternative: a shared question
// gets a shared pure helper with a structural client parameter, and no module
// imports another. Two implementations would eventually disagree, and the
// symptom would be a roadmap phase and a course card disagreeing about the
// same course's total minutes.

/**
 * The subset of PrismaService this needs. Structural rather than nominal —
 * same technique as StudyTimeSumClient/ActivityScanClient — so it stays
 * mockable without Prisma and accepts anything shaped like a Prisma client.
 */
export interface EstimatedMinutesClient {
  lesson: {
    groupBy(
      args: unknown,
    ): Promise<
      { courseId: string; _sum: { estimatedStudyMinutes: number | null } }[]
    >;
  };
}

/**
 * Total `estimatedStudyMinutes` across PUBLISHED lessons, per course id.
 *
 * Prisma cannot sum a relation inside `select`, so this is one groupBy over
 * the given ids — constant cost regardless of how many lessons a course has,
 * no N+1 across courses. A course id with no matching lessons (or none
 * carrying a duration) is simply absent from the returned map; callers apply
 * their own `?? 0` fallback rather than this helper guessing one.
 */
export const getEstimatedMinutesByCourseId = async (
  prisma: EstimatedMinutesClient,
  courseIds: string[],
): Promise<Map<string, number>> => {
  if (courseIds.length === 0) return new Map();

  const grouped = await prisma.lesson.groupBy({
    by: ['courseId'],
    where: { courseId: { in: courseIds }, isPublished: true },
    _sum: { estimatedStudyMinutes: true },
  });

  return new Map(
    grouped.map((row) => [row.courseId, row._sum.estimatedStudyMinutes ?? 0]),
  );
};
