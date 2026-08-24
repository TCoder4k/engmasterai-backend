import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GamificationService } from '../../gamification/gamification.service';
import { visibleContentWhere } from '../listening-visibility';
import {
  DictationSegmentProgressDto,
  ListeningDictationProgressDto,
  ListeningDictationSummaryDto,
  ListeningProgressSummaryDto,
  SubmitDictationAttemptResultDto,
} from '../listening.types';
import { SubmitDictationAttemptDto } from '../dto';
import { scoreDictationAttempt } from './dictation-scoring';

// Sprint 11 Phase 4A — Dictation progress, server-authoritative.
//
// THE ONE SENTENCE THIS MODULE IS ABOUT: the client sends what the student
// typed, and the server decides everything else. Accuracy, word counts and
// completion are computed here from the stored reference; none of them can be
// asserted by a request, because `SubmitDictationAttemptDto` has no field for
// them.
//
// NOTHING IS CACHED. There is no `completedSegmentCount` column anywhere in
// this module. Every content-level figure below is a `count()` against the
// live segment list, which is what makes segment editing safe on published
// content: add a sentence and the recording correctly drops back to
// in-progress for everyone, with no counter to recount and no backfill to run.
// The Sprint 11 plan called this out as the decision that makes the Cascade on
// `ListeningSegment.content` survivable, and it is.

/** Only sentences the student has touched. Absence IS "not started". */
const SEGMENT_PROGRESS_SELECT = {
  segmentId: true,
  completedAt: true,
  bestAccuracyPercent: true,
  attemptCount: true,
  assisted: true,
} as const satisfies Prisma.ListeningDictationSegmentProgressSelect;

@Injectable()
export class DictationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gamification: GamificationService,
  ) {}

  /**
   * Submit one attempt.
   *
   * Order of operations matters and is not incidental:
   *   1. resolve the segment THROUGH the visibility predicate — a draft
   *      recording must 404 on write exactly as it does on read, or the write
   *      path becomes the enumeration hole the read path closed;
   *   2. replay an already-seen `clientAttemptId` before touching anything;
   *   3. score from the STORED reference;
   *   4. write the attempt and upsert the progress row in one transaction.
   */
  async submitAttempt(
    userId: string,
    segmentId: string,
    dto: SubmitDictationAttemptDto,
  ): Promise<SubmitDictationAttemptResultDto> {
    // The same 404 as a missing segment for: a draft recording, a recording in
    // a draft category, and a recording that does not enable DICTATION. A
    // distinguishing message here would undo listening-visibility.ts.
    const segment = await this.prisma.listeningSegment.findFirst({
      where: {
        id: segmentId,
        content: { ...visibleContentWhere, supportedModes: { has: 'DICTATION' } },
      },
      select: {
        id: true,
        contentId: true,
        text: true,
        normalizedText: true,
      },
    });

    if (!segment) {
      throw new NotFoundException(
        `Listening segment with ID ${segmentId} not found`,
      );
    }

    // IDEMPOTENCY, CHECKED FIRST. A replay returns the ORIGINAL recorded
    // outcome rather than re-grading: the reference sentence may have been
    // edited since, and re-scoring the same submission against new text would
    // hand a student two different results for one attempt.
    const existing = await this.prisma.listeningDictationAttempt.findUnique({
      where: { userId_clientAttemptId: { userId, clientAttemptId: dto.clientAttemptId } },
      select: {
        segmentId: true,
        accuracyPercent: true,
        wordsCorrect: true,
        wordsTotal: true,
        solved: true,
        revealedWordCount: true,
        contentId: true,
      },
    });

    if (existing) {
      const [segmentRow, content] = await Promise.all([
        this.prisma.listeningDictationSegmentProgress.findUnique({
          where: { userId_segmentId: { userId, segmentId: existing.segmentId } },
          select: SEGMENT_PROGRESS_SELECT,
        }),
        this.summariseContent(userId, existing.contentId),
      ]);

      return {
        accuracyPercent: existing.accuracyPercent,
        wordsCorrect: existing.wordsCorrect,
        wordsTotal: existing.wordsTotal,
        solved: existing.solved,
        assisted: existing.revealedWordCount > 0,
        segment: segmentRow ?? emptySegmentProgress(existing.segmentId),
        content,
      };
    }

    const score = scoreDictationAttempt({
      normalizedReference: segment.normalizedText,
      typedText: dto.typedText,
      revealedWordCount: dto.revealedWordCount,
    });

    const now = new Date();

    const segmentRow = await this.prisma.$transaction(async (tx) => {
      await tx.listeningDictationAttempt.create({
        data: {
          userId,
          segmentId: segment.id,
          // From the SEGMENT, never from the request. A contentId in a body
          // would let a caller file an attempt against a recording they never
          // opened.
          contentId: segment.contentId,
          typedText: dto.typedText,
          revealedWordCount: dto.revealedWordCount,
          // The sentence AS IT WAS WHEN GRADED, so a later admin typo fix
          // cannot make an old score unexplainable.
          referenceTextSnapshot: segment.text,
          accuracyPercent: score.accuracyPercent,
          wordsCorrect: score.wordsCorrect,
          wordsTotal: score.wordsTotal,
          solved: score.solved,
          clientAttemptId: dto.clientAttemptId,
        },
      });

      const previous = await tx.listeningDictationSegmentProgress.findUnique({
        where: { userId_segmentId: { userId, segmentId: segment.id } },
        select: { bestAccuracyPercent: true, completedAt: true, assisted: true },
      });

      const progress = await tx.listeningDictationSegmentProgress.upsert({
        where: { userId_segmentId: { userId, segmentId: segment.id } },
        create: {
          userId,
          segmentId: segment.id,
          contentId: segment.contentId,
          completedAt: score.solved ? now : null,
          bestAccuracyPercent: score.accuracyPercent,
          attemptCount: 1,
          assisted: score.assisted,
          lastAttemptAt: now,
        },
        update: {
          // completedAt is set once and NEVER cleared — the same contract as
          // LessonStepProgress. A later failed attempt does not un-finish a
          // sentence the student already transcribed correctly.
          completedAt:
            previous?.completedAt ?? (score.solved ? now : null),
          // Monotonic. A retry can only raise this.
          bestAccuracyPercent: Math.max(
            previous?.bestAccuracyPercent ?? 0,
            score.accuracyPercent,
          ),
          attemptCount: { increment: 1 },
          // Sticky: a sentence solved with help was not solved unaided, and a
          // later clean run does not rewrite that history.
          assisted: (previous?.assisted ?? false) || score.assisted,
          lastAttemptAt: now,
        },
        select: SEGMENT_PROGRESS_SELECT,
      });

      // A submitted attempt is a qualifying activity day, same as a quiz
      // submission — see activity-window.ts. No XP award: this only feeds
      // the streak; awarding XP for listening is a separate product call
      // nobody has made yet.
      await this.gamification.recordProgress(tx, userId, {
        at: now,
        awards: [],
        countsAsActivity: true,
      });

      return progress;
    });

    return {
      accuracyPercent: score.accuracyPercent,
      wordsCorrect: score.wordsCorrect,
      wordsTotal: score.wordsTotal,
      solved: score.solved,
      assisted: score.assisted,
      segment: segmentRow,
      content: await this.summariseContent(userId, segment.contentId),
    };
  }

  /**
   * The content-detail block: derived summary plus the per-sentence rows.
   *
   * This is what makes a refresh mid-exercise lossless — the client rebuilds
   * "which sentences are done" from these rows rather than from anything it
   * kept in memory.
   */
  async findContentProgress(
    userId: string,
    contentId: string,
  ): Promise<ListeningDictationProgressDto> {
    const [summary, segments] = await Promise.all([
      this.summariseContent(userId, contentId),
      this.prisma.listeningDictationSegmentProgress.findMany({
        where: { userId, contentId },
        select: SEGMENT_PROGRESS_SELECT,
      }),
    ]);

    return { ...summary, segments };
  }

  /**
   * The catalog's batch read.
   *
   * THREE QUERIES, INDEPENDENT OF THE NUMBER OF IDS. `groupBy` is what needs
   * the duplicated `contentId` column on the progress row — Prisma cannot
   * group by a relation field, and without it this would be one query per
   * card. The e2e asserts the count is identical for 1 id and 20.
   *
   * Ids the student cannot see are simply absent from the result, matching
   * `filterVisibleContentIds`: one stale id must not fail a whole catalog page.
   */
  async findProgressSummaries(
    userId: string,
    contentIds: string[],
  ): Promise<ListeningProgressSummaryDto[]> {
    if (contentIds.length === 0) return [];

    const contents = await this.prisma.listeningContent.findMany({
      where: { id: { in: contentIds }, ...visibleContentWhere },
      select: {
        id: true,
        supportedModes: true,
        _count: { select: { segments: true } },
      },
    });

    if (contents.length === 0) return [];
    const visibleIds = contents.map((content) => content.id);

    const [completedGroups, activity] = await Promise.all([
      this.prisma.listeningDictationSegmentProgress.groupBy({
        by: ['contentId'],
        where: {
          userId,
          contentId: { in: visibleIds },
          completedAt: { not: null },
        },
        _count: { _all: true },
      }),
      this.prisma.listeningDictationSegmentProgress.groupBy({
        by: ['contentId'],
        where: { userId, contentId: { in: visibleIds } },
        _max: { lastAttemptAt: true },
      }),
    ]);

    const completedByContent = new Map(
      completedGroups.map((row) => [row.contentId, row._count._all]),
    );
    const activityByContent = new Map(
      activity.map((row) => [row.contentId, row._max.lastAttemptAt]),
    );

    return contents.map((content) => ({
      contentId: content.id,
      dictation: content.supportedModes.includes('DICTATION')
        ? summarise(
            content._count.segments,
            completedByContent.get(content.id) ?? 0,
            activityByContent.get(content.id) ?? null,
          )
        : null,
    }));
  }

  /** One recording's derived summary. Two counts, nothing stored. */
  async summariseContent(
    userId: string,
    contentId: string,
  ): Promise<ListeningDictationSummaryDto> {
    const [totalSegments, completedSegments, activity] = await Promise.all([
      this.prisma.listeningSegment.count({ where: { contentId } }),
      this.prisma.listeningDictationSegmentProgress.count({
        where: { userId, contentId, completedAt: { not: null } },
      }),
      this.prisma.listeningDictationSegmentProgress.aggregate({
        where: { userId, contentId },
        _max: { lastAttemptAt: true },
      }),
    ]);

    return summarise(totalSegments, completedSegments, activity._max.lastAttemptAt);
  }
}

const emptySegmentProgress = (
  segmentId: string,
): DictationSegmentProgressDto => ({
  segmentId,
  completedAt: null,
  bestAccuracyPercent: null,
  attemptCount: 0,
  assisted: false,
});

/**
 * The completion rule, in one place.
 *
 * `totalSegments > 0` is load-bearing: a recording with no sentences is not
 * complete, it is empty, and `0 === 0` would otherwise report a student as
 * having finished work that never existed. This is the same trap
 * `lesson-status.ts` names as `NO_CONTENT`.
 */
const summarise = (
  totalSegments: number,
  completedSegments: number,
  lastActivityAt: Date | null,
): ListeningDictationSummaryDto => ({
  totalSegments,
  completedSegments,
  completed: totalSegments > 0 && completedSegments === totalSegments,
  // NOT accompanied by a `startedAt`. The obvious derivation --
  // `min(lastAttemptAt)` -- would be WRONG, because that column is overwritten
  // on every attempt, so its minimum is "the least recently touched sentence"
  // rather than when the student began. The accurate source is
  // `min(submittedAt)` on the append-only attempt table, which costs another
  // query; nothing renders a start time today, so the field is absent rather
  // than present and subtly false.
  lastActivityAt,
});
