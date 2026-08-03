// Sprint 10.5 — the ONE definition of "how many study seconds has this student
// been credited since a given instant", shared by the two features that ask it.
//
// WHY IT LIVES HERE RATHER THAN ON StudyTimeService. Two domains ask the same
// question: StudyTimeService needs today's total to clamp the next heartbeat,
// and DashboardAnalyticsService needs it to render the Daily Goal widget.
// Exporting it from the service would force AnalyticsModule to import
// StudyTimeModule for a SUM — coupling two modules so one can borrow a query.
//
// activity-window.ts already established the alternative in Sprint 10 and the
// reasoning is identical: a shared question gets a shared pure helper with a
// structural client parameter, and no module imports another. Two
// implementations would eventually disagree, and the symptom would be a cap
// that refuses time the dashboard is simultaneously displaying.

/**
 * The subset of PrismaService this needs.
 *
 * Structural rather than nominal so it accepts BOTH `PrismaService` and a
 * `Prisma.TransactionClient` — the heartbeat write needs this inside its own
 * transaction, the dashboard read does not. Same technique as
 * ActivityScanClient, and it keeps the helper mockable without Prisma.
 */
export interface StudyTimeSumClient {
  studyTimeEvent: {
    // `_sum` and its fields are BOTH optional, matching what Prisma's generated
    // aggregate type actually promises: which sub-objects come back depends on
    // the args, and the compiler cannot narrow that from an `unknown` arg. A
    // tighter signature here does not make the value safer — it makes
    // PrismaService stop being assignable to this interface at all.
    aggregate(args: unknown): Promise<{
      _sum?: { creditedSeconds?: number | null };
    }>;
  };
}

/**
 * Total credited study seconds for `userId` at or after `since`.
 *
 * Served by `@@index([userId, occurredAt])`. Returns 0 rather than null for an
 * account with no rows — Postgres SUM over an empty set is NULL, and letting
 * that reach a DTO would render "null phút" on the widget.
 */
export const sumStudySecondsSince = async (
  prisma: StudyTimeSumClient,
  userId: string,
  since: Date,
): Promise<number> => {
  const result = await prisma.studyTimeEvent.aggregate({
    where: { userId, occurredAt: { gte: since } },
    _sum: { creditedSeconds: true },
  });

  return result._sum?.creditedSeconds ?? 0;
};
