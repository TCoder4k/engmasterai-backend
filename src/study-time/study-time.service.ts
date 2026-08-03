import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { startOfDayInTimeZone } from '../learning/timezone.util';
import { sumStudySecondsSince } from '../shared/study-time-window';
import { creditableSeconds } from './creditable-seconds';
import { StudyHeartbeatDto } from './dto/study-heartbeat.dto';
import { StudyHeartbeatResponseDto } from './study-time.types';

// Sprint 10.5 — the write side of study time.
//
// THE ONLY WRITER of StudyTimeEvent. Two queries per heartbeat, both inside one
// transaction: the day's running total, then a conflict-free insert.
//
// TIMEZONE: the STORED column wins here, with no bootstrap — deliberately the
// opposite of DashboardAnalyticsService, which lets the request's `tz` win.
//
// Writing User.timezone is owned by LearningService.getDueReviews (which spends
// the SRS quota) and by DashboardAnalyticsService. Adding a third writer on what
// is about to become the most frequent authenticated write in the app would
// make "who set this column" unanswerable. And the ceiling must not be
// re-scalable by a request parameter: a client that could pick the timezone
// could pick the one whose local midnight is furthest in the past and hand
// itself the widest ceiling.
//
// The resulting asymmetry — cap bucketed by the stored zone, display bucketed
// by the requested one — is safe because the cap is SELF-CONSISTENT: usedToday
// and elapsedToday are measured from the same dayStart, so it never refuses
// genuine study time. It also self-corrects, since the first dashboard load
// bootstraps the column. Do not "fix" this into symmetry; the two endpoints
// want different things from the same column.
@Injectable()
export class StudyTimeService {
  constructor(private readonly prisma: PrismaService) {}

  async recordHeartbeat(
    userId: string,
    dto: StudyHeartbeatDto,
  ): Promise<StudyHeartbeatResponseDto> {
    // The server's clock, always. No request field can move this.
    const now = new Date();

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { timezone: true },
    });
    const timeZone = user.timezone ?? 'UTC';
    const dayStart = startOfDayInTimeZone(now, timeZone);

    return this.prisma.$transaction(async (tx) => {
      const usedToday = await sumStudySecondsSince(tx, userId, dayStart);
      const elapsedToday = Math.floor(
        (now.getTime() - dayStart.getTime()) / 1000,
      );

      const credited = creditableSeconds({
        requested: dto.activeSeconds,
        usedToday,
        elapsedToday,
      });

      // Nothing to record. Returning before the insert also means a client
      // hammering a spent day writes no rows at all, rather than a stream of
      // zero-second ones that would make the ledger unreadable.
      if (credited === 0) return { acceptedSeconds: 0 };

      // Conflict-free, never try/catch. A failed statement aborts the whole
      // Postgres transaction and Prisma exposes no savepoint, so a catch could
      // not recover — it could only turn a rollback into a 500. Making the
      // insert conflict-free means the expected collision is not an error.
      //
      // createManyAndReturn rather than createMany because the CALLER needs to
      // know which branch it took: `[]` means this exact (session, sequence)
      // was already recorded, and the honest answer is 0 accepted seconds.
      const inserted = await tx.studyTimeEvent.createManyAndReturn({
        data: [
          {
            userId,
            activityType: dto.activityType,
            activityId: dto.activityId ?? null,
            clientSessionId: dto.clientSessionId,
            sequence: dto.sequence,
            creditedSeconds: credited,
            occurredAt: now,
          },
        ],
        skipDuplicates: true,
        select: { creditedSeconds: true },
      });

      if (inserted.length === 0) return { acceptedSeconds: 0 };

      return { acceptedSeconds: inserted[0].creditedSeconds };
    });
  }
}
