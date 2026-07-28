import { Injectable } from '@nestjs/common';
import { LearningState, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { VocabWordService } from '../vocab-word/vocab-word.service';
import { VocabDeckService } from '../vocab-deck/vocab-deck.service';
import { VocabLibraryService } from '../vocab-library/vocab-library.service';
import { LearningEventLogger } from './logging/learning-event-logger.service';
import { SubmitReviewDto } from './dto/submit-review.dto';
import { QueryDueReviewsDto } from './dto/query-due-reviews.dto';
import {
  IdempotencyKeyReusedException,
  ReviewVersionConflictException,
} from './learning.exceptions';
import {
  next as schedulerNext,
  previewIntervals,
  DEFAULT_NEW_PROGRESS,
  ProgressSnapshot,
  PreviewIntervals,
} from './srs/scheduler';
import { startOfDayInTimeZone } from './timezone.util';
import {
  DueQueueItemDto,
  DueQueueResponseDto,
  DueQueueWordDto,
  ReviewResponseDto,
  DeckProgressDto,
  LibraryProgressDto,
  LibrarySummaryProgressDto,
} from './learning.types';

const DEFAULT_QUEUE_LIMIT = 200;
const DEFAULT_NEW_LIMIT = 20;
// When no deck/library scope narrows the candidate set, fetch a larger
// pool before interleaving by deck (§8's fairness requirement) so one huge
// deck's overdue backlog can't crowd out a smaller deck just because a
// plain `ORDER BY nextReviewAt` would put all of it first.
const QUEUE_CANDIDATE_SCAN_MULTIPLIER = 3;

const DUE_QUEUE_WORD_SELECT = {
  id: true,
  text: true,
  ipa: true,
  cefrLevel: true,
  audioUrl: true,
  imageUrl: true,
  meanings: {
    select: { id: true, partOfSpeech: true, meaning: true, orderIndex: true },
    orderBy: { orderIndex: 'asc' as const },
  },
};

// A sentinel thrown (never a real business error) to signal "the create()
// lost the lazy-creation race — re-enter as an update against the winner's
// row" up to the caller in submitReview, which bounds it to exactly one
// retry (sprint plan §11).
class RetrySignal extends Error {}

const isUniqueConstraintViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2002';

@Injectable()
export class LearningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vocabWordService: VocabWordService,
    private readonly vocabDeckService: VocabDeckService,
    private readonly vocabLibraryService: VocabLibraryService,
    private readonly eventLogger: LearningEventLogger,
  ) {}

  // GET /learning/reviews/due (sprint plan §8).
  async getDueReviews(
    userId: string,
    query: QueryDueReviewsDto,
  ): Promise<DueQueueResponseDto> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });

    // One-time bootstrap only, never re-applied once set — closes the
    // "reset my daily new-word quota by spoofing tz" gap (§8/§16).
    let timezone = user.timezone;
    if (!timezone && query.tz) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { timezone: query.tz },
      });
      timezone = query.tz;
    }
    const effectiveTz = timezone ?? 'UTC';

    const limit = query.limit ?? DEFAULT_QUEUE_LIMIT;
    const includeNew = query.includeNew ?? true;
    const newLimit = query.newLimit ?? DEFAULT_NEW_LIMIT;

    const now = new Date();
    const startOfToday = startOfDayInTimeZone(now, effectiveTz);

    const visible = await this.getVisibleWordIdsWithDeck(
      query.deckId,
      query.libraryId,
    );
    if (visible.length === 0) {
      this.eventLogger.log('learning.queue.loaded', {
        userId,
        totalReturned: 0,
      });
      return { data: [] };
    }
    const visibleWordIds = visible.map((v) => v.wordId);
    const wordToDeck = new Map(visible.map((v) => [v.wordId, v.deckId]));
    const scopedToOneDeckOrLibrary = Boolean(query.deckId || query.libraryId);

    const dueRows = await this.prisma.userWordProgress.findMany({
      where: {
        userId,
        wordId: { in: visibleWordIds },
        state: { not: 'NEW' },
        nextReviewAt: { lte: now },
      },
      orderBy: { nextReviewAt: 'asc' }, // overdue-first falls out of this ordering alone
      take: scopedToOneDeckOrLibrary
        ? limit
        : limit * QUEUE_CANDIDATE_SCAN_MULTIPLIER,
    });

    const dueRowsFinal = scopedToOneDeckOrLibrary
      ? dueRows.slice(0, limit)
      : this.interleaveByDeck(dueRows, wordToDeck, limit);

    let newWordRows: DueQueueWordDto[] = [];
    if (includeNew && dueRowsFinal.length < limit) {
      const alreadyTracked = await this.prisma.userWordProgress.findMany({
        where: { userId, wordId: { in: visibleWordIds } },
        select: { wordId: true },
      });
      const trackedIds = new Set(alreadyTracked.map((p) => p.wordId));
      const candidateNew = visible.filter((v) => !trackedIds.has(v.wordId));

      // A word only actually consumes the daily "new" quota once it's
      // genuinely rated for the first time (lazy creation, §7) — merely
      // being shown unrated in a queue view creates no row and costs
      // nothing, matching the same "no fabricated writes" discipline the
      // rest of this codebase already follows.
      const introducedTodayCount = await this.prisma.userWordProgress.count({
        where: { userId, createdAt: { gte: startOfToday } },
      });
      const remainingQuota = Math.max(0, newLimit - introducedTodayCount);
      const newSlots = Math.min(remainingQuota, limit - dueRowsFinal.length);

      if (newSlots > 0) {
        const candidatePool = scopedToOneDeckOrLibrary
          ? candidateNew.slice(0, newSlots)
          : this.interleaveByDeck(candidateNew, wordToDeck, newSlots);

        if (candidatePool.length > 0) {
          newWordRows = await this.prisma.vocabWord.findMany({
            where: { id: { in: candidatePool.map((c) => c.wordId) } },
            select: DUE_QUEUE_WORD_SELECT,
            orderBy: { text: 'asc' },
          });
        }
      }
    }

    const dueWordDetails =
      dueRowsFinal.length > 0
        ? await this.prisma.vocabWord.findMany({
            where: { id: { in: dueRowsFinal.map((r) => r.wordId) } },
            select: DUE_QUEUE_WORD_SELECT,
          })
        : [];
    const wordDetailById = new Map(dueWordDetails.map((w) => [w.id, w]));

    const dueItems: DueQueueItemDto[] = dueRowsFinal
      .map((row): DueQueueItemDto | null => {
        const word = wordDetailById.get(row.wordId);
        if (!word) return null; // defensive/unreachable — word rows are Restrict-protected while progress exists
        return {
          word,
          isNew: false,
          progress: {
            state: row.state,
            intervalDays: row.intervalDays,
            nextReviewAt: row.nextReviewAt,
            easeFactor: row.easeFactor,
            repetitions: row.repetitions,
            lapses: row.lapses,
          },
          previewIntervals: previewIntervals(this.toProgressSnapshot(row), now),
        };
      })
      .filter((item): item is DueQueueItemDto => item !== null);

    const newItems: DueQueueItemDto[] = newWordRows.map((word) => ({
      word,
      isNew: true,
      progress: null,
      previewIntervals: previewIntervals(DEFAULT_NEW_PROGRESS, now),
    }));

    const data = [...dueItems, ...newItems];
    this.eventLogger.log('learning.queue.loaded', {
      userId,
      totalReturned: data.length,
    });
    return { data };
  }

  // GET /learning/words/:wordId/progress — Sprint 04C addition. The
  // due-queue response (getDueReviews) is the plan's only originally-named
  // carrier for previewIntervals, but it only ever surfaces due/new words
  // (§8) — Flashcard's whole-deck practice (04C) needs a word's current
  // progress + preview regardless of whether it's actually due today, since
  // it lets a learner study ahead of schedule. Reuses the exact same
  // visibility gate and snapshot/preview logic as the due queue and the
  // rating endpoint — no new predicate invented.
  async getWordProgress(
    userId: string,
    wordId: string,
  ): Promise<{
    progress: {
      state: LearningState;
      intervalDays: number;
      nextReviewAt: Date;
      easeFactor: number;
      repetitions: number;
      lapses: number;
    } | null;
    previewIntervals: PreviewIntervals;
  }> {
    await this.vocabWordService.findOneVisibleToUser(wordId, { userId });

    const row = await this.prisma.userWordProgress.findUnique({
      where: { userId_wordId: { userId, wordId } },
    });
    const now = new Date();

    if (!row) {
      return {
        progress: null,
        previewIntervals: previewIntervals(DEFAULT_NEW_PROGRESS, now),
      };
    }

    return {
      progress: {
        state: row.state,
        intervalDays: row.intervalDays,
        nextReviewAt: row.nextReviewAt,
        easeFactor: row.easeFactor,
        repetitions: row.repetitions,
        lapses: row.lapses,
      },
      previewIntervals: previewIntervals(this.toProgressSnapshot(row), now),
    };
  }

  // GET /learning/decks/:deckId/progress (sprint plan §13, Sprint 04D).
  async getDeckProgress(
    userId: string,
    deckId: string,
  ): Promise<DeckProgressDto> {
    await this.vocabDeckService.findOnePublished(deckId, { userId }); // 404s if not currently visible
    const visible = await this.getVisibleWordIdsWithDeck(deckId);
    const summary = await this.computeProgressSummary(
      userId,
      visible.map((v) => v.wordId),
    );
    return { deckId, ...summary };
  }

  // GET /learning/libraries/:libraryId/progress (sprint plan §13, Sprint 04D).
  // Returns the library-wide aggregate AND a per-deck breakdown in one
  // request — computed from one shared word-visibility query, not N+1
  // per-deck round trips (a real concern: the TOEIC 600 library alone has
  // 50 decks).
  async getLibraryProgress(
    userId: string,
    libraryId: string,
  ): Promise<LibraryProgressDto> {
    await this.vocabLibraryService.findOnePublished(libraryId); // 404s if not currently visible

    // Raw (non-deduped) pairs for the per-deck breakdown — a word shared
    // between two decks must count toward BOTH decks' own totals. The
    // library-wide aggregate below instead uses the deduped distinct word
    // set, so that same shared word is only counted once at that level.
    const pairs = await this.getVisibleDeckWordPairs(undefined, libraryId);
    const distinctWordIds = [...new Set(pairs.map((p) => p.wordId))];
    const librarySummary = await this.computeProgressSummary(
      userId,
      distinctWordIds,
    );

    const deckIds = [...new Set(pairs.map((p) => p.deckId))];
    const wordIdsByDeck = new Map<string, string[]>();
    for (const { wordId, deckId } of pairs) {
      const list = wordIdsByDeck.get(deckId);
      if (list) list.push(wordId);
      else wordIdsByDeck.set(deckId, [wordId]);
    }

    // One query for every deck's progress rows, then partitioned in memory
    // by deck — still a single round trip regardless of deck count.
    const allProgress = await this.prisma.userWordProgress.findMany({
      where: { userId, wordId: { in: distinctWordIds } },
      select: { wordId: true, state: true, nextReviewAt: true },
    });
    const progressByWordId = new Map(allProgress.map((p) => [p.wordId, p]));

    const decks: DeckProgressDto[] = deckIds.map((deckId) => {
      const wordIds = wordIdsByDeck.get(deckId) ?? [];
      const rows = wordIds
        .map((id) => progressByWordId.get(id))
        .filter((r): r is NonNullable<typeof r> => Boolean(r));
      return { deckId, ...this.summarizeProgressRows(wordIds.length, rows) };
    });

    return { libraryId, ...librarySummary, decks };
  }

  // POST /learning/words/:wordId/review (sprint plan §9/§10/§11).
  async submitReview(
    userId: string,
    wordId: string,
    dto: SubmitReviewDto,
  ): Promise<ReviewResponseDto> {
    const existingLog = await this.prisma.wordReviewLog.findUnique({
      where: {
        userId_clientReviewId: { userId, clientReviewId: dto.clientReviewId },
      },
    });

    if (existingLog) {
      if (
        existingLog.wordId !== wordId ||
        existingLog.rating !== dto.rating ||
        existingLog.practiceMode !== dto.practiceMode
      ) {
        this.eventLogger.log('learning.review.idempotency_conflict', {
          userId,
          wordId,
          rating: dto.rating,
        });
        throw new IdempotencyKeyReusedException();
      }
      this.eventLogger.log('learning.review.idempotent_replay', {
        userId,
        wordId,
        rating: dto.rating,
        resultVersion: existingLog.resultVersion,
      });
      return this.snapshotResponse(existingLog);
    }

    // Visibility gate, reached only on a fresh submission — an idempotent
    // replay of an already-recorded review (above) must succeed regardless
    // of the word's *current* visibility, since it creates no new state
    // change. First-time and ongoing ratings are both gated identically
    // (§7/§9/§17): reuses the exact same predicate VocabWordService's
    // student-facing GET already enforces, via its exported service.
    await this.vocabWordService.findOneVisibleToUser(wordId, { userId });

    return this.attemptReview(userId, wordId, dto, 1);
  }

  private async attemptReview(
    userId: string,
    wordId: string,
    dto: SubmitReviewDto,
    attempt: 1 | 2,
  ): Promise<ReviewResponseDto> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        let progress = await tx.userWordProgress.findUnique({
          where: { userId_wordId: { userId, wordId } },
        });
        let isNewlyCreated = false;

        if (!progress) {
          try {
            // Relies on the model's own @default values (state NEW,
            // easeFactor 2.5, intervalDays 0, ...) — never duplicated here.
            progress = await tx.userWordProgress.create({
              data: { userId, wordId },
            });
            isNewlyCreated = true;
          } catch (error) {
            if (isUniqueConstraintViolation(error)) {
              if (attempt >= 2) throw new ReviewVersionConflictException();
              throw new RetrySignal();
            }
            throw error;
          }
        }

        const before: ProgressSnapshot = this.toProgressSnapshot(progress);
        const now = new Date();
        const result = schedulerNext(before, dto.rating, now);

        const updateResult = await tx.userWordProgress.updateMany({
          where: { id: progress.id, version: progress.version },
          data: {
            state: result.state,
            easeFactor: result.easeFactor,
            intervalDays: result.intervalDays,
            repetitions: result.repetitions,
            lapses: result.lapses,
            lastReviewedAt: now,
            nextReviewAt: result.nextReviewAt,
            firstLearnedAt: result.firstLearnedAt,
            masteredAt: result.masteredAt,
            version: { increment: 1 },
          },
        });
        if (updateResult.count === 0)
          throw new ReviewVersionConflictException();

        const resultVersion = progress.version + 1;
        const log = await tx.wordReviewLog.create({
          data: {
            userId,
            wordId,
            progressId: progress.id,
            rating: dto.rating,
            previousState: before.state,
            newState: result.state,
            previousIntervalDays: before.intervalDays,
            newIntervalDays: result.intervalDays,
            previousDueAt: progress.nextReviewAt,
            newDueAt: result.nextReviewAt,
            newEaseFactor: result.easeFactor,
            newRepetitions: result.repetitions,
            newLapses: result.lapses,
            resultVersion,
            practiceMode: dto.practiceMode,
            sessionId: dto.sessionId,
            clientReviewId: dto.clientReviewId,
            responseTimeMs: dto.responseTimeMs,
          },
        });

        if (isNewlyCreated) {
          this.eventLogger.log('learning.progress.created', { userId, wordId });
        }
        if (before.state !== 'MASTERED' && result.state === 'MASTERED') {
          this.eventLogger.log('learning.progress.mastered', {
            userId,
            wordId,
            intervalDays: result.intervalDays,
          });
        }
        if (result.state === 'RELEARNING' && before.state !== 'RELEARNING') {
          this.eventLogger.log('learning.progress.lapsed', { userId, wordId });
        }
        this.eventLogger.log('learning.review.submitted', {
          userId,
          wordId,
          rating: dto.rating,
          practiceMode: dto.practiceMode,
          previousState: before.state,
          newState: result.state,
          intervalDays: result.intervalDays,
          resultVersion,
          responseTimeMs: dto.responseTimeMs,
        });

        return this.snapshotResponse(log);
      });
    } catch (error) {
      if (error instanceof RetrySignal) {
        if (attempt >= 2) throw new ReviewVersionConflictException();
        return this.attemptReview(userId, wordId, dto, 2); // exactly one retry, then give up — §11
      }
      if (error instanceof ReviewVersionConflictException) {
        this.eventLogger.log('learning.review.version_conflict', {
          userId,
          wordId,
          rating: dto.rating,
        });
      }
      throw error;
    }
  }

  // Every (deck, word) pair a query may consider — a pair is included iff
  // its deck is published and its library is published, optionally
  // narrowed to one deck/library. NOT deduped: a word attached to two
  // decks appears once per deck here, which is exactly what a per-deck
  // breakdown (getLibraryProgress) needs. Callers that want "how many
  // distinct words" (the due queue, a deck/library-wide total) should go
  // through getVisibleWordIdsWithDeck below instead.
  private async getVisibleDeckWordPairs(
    deckId?: string,
    libraryId?: string,
  ): Promise<{ wordId: string; deckId: string }[]> {
    return this.prisma.vocabDeckWord.findMany({
      where: {
        ...(deckId && { deckId }),
        deck: {
          isPublished: true,
          library: {
            isPublished: true,
            ...(libraryId && { id: libraryId }),
          },
        },
      },
      select: { wordId: true, deckId: true },
    });
  }

  // Deduped by wordId (a word can be attached to multiple decks); the
  // first deck seen is used only for the due-queue's fairness interleave,
  // never for any visibility decision or per-deck accounting. Do NOT reuse
  // this for a per-deck breakdown — see getVisibleDeckWordPairs above
  // (a real bug this comment replaces: an earlier version of
  // getLibraryProgress reused this deduped list for its per-deck
  // breakdown, which silently dropped any deck whose words were all
  // "already seen" via an earlier deck).
  private async getVisibleWordIdsWithDeck(
    deckId?: string,
    libraryId?: string,
  ): Promise<{ wordId: string; deckId: string }[]> {
    const deckWords = await this.getVisibleDeckWordPairs(deckId, libraryId);

    const seen = new Set<string>();
    const result: { wordId: string; deckId: string }[] = [];
    for (const dw of deckWords) {
      if (seen.has(dw.wordId)) continue;
      seen.add(dw.wordId);
      result.push(dw);
    }
    return result;
  }

  // Best-effort fairness (§8): round-robins across owning decks so one
  // large deck's backlog can't crowd out a smaller deck, while preserving
  // each deck's own internal ordering (the input is already sorted by
  // nextReviewAt before this runs).
  private interleaveByDeck<T extends { wordId: string }>(
    items: T[],
    wordToDeck: Map<string, string>,
    limit: number,
  ): T[] {
    const groups = new Map<string, T[]>();
    for (const item of items) {
      const deckId = wordToDeck.get(item.wordId) ?? 'unknown';
      const group = groups.get(deckId);
      if (group) group.push(item);
      else groups.set(deckId, [item]);
    }

    const groupArrays = [...groups.values()];
    const result: T[] = [];
    let index = 0;
    while (result.length < limit && groupArrays.some((g) => index < g.length)) {
      for (const group of groupArrays) {
        if (result.length >= limit) break;
        if (index < group.length) result.push(group[index]);
      }
      index += 1;
    }
    return result;
  }

  private toProgressSnapshot(row: {
    state: LearningState;
    easeFactor: number;
    intervalDays: number;
    repetitions: number;
    lapses: number;
    masteredAt: Date | null;
    firstLearnedAt: Date | null;
  }): ProgressSnapshot {
    return {
      state: row.state,
      easeFactor: row.easeFactor,
      intervalDays: row.intervalDays,
      repetitions: row.repetitions,
      lapses: row.lapses,
      masteredAt: row.masteredAt,
      firstLearnedAt: row.firstLearnedAt,
    };
  }

  // Reconstructed purely from a WordReviewLog row's own snapshot fields —
  // never a live re-read of UserWordProgress. This is precisely what makes
  // an idempotent replay return the *original* recorded outcome regardless
  // of anything that has happened to the word since (§10).
  private snapshotResponse(log: {
    newState: LearningState;
    newIntervalDays: number;
    newDueAt: Date;
    newEaseFactor: number;
    newRepetitions: number;
    newLapses: number;
    resultVersion: number;
  }): ReviewResponseDto {
    return {
      state: log.newState,
      intervalDays: log.newIntervalDays,
      nextReviewAt: log.newDueAt,
      easeFactor: log.newEaseFactor,
      repetitions: log.newRepetitions,
      lapses: log.newLapses,
      version: log.resultVersion,
    };
  }

  // Fetches this user's progress rows for exactly `wordIds` and summarizes
  // them — the shared core both getDeckProgress and getLibraryProgress's
  // aggregate build on.
  private async computeProgressSummary(
    userId: string,
    wordIds: string[],
  ): Promise<Omit<DeckProgressDto, 'deckId'>> {
    if (wordIds.length === 0) return this.summarizeProgressRows(0, []);

    const rows = await this.prisma.userWordProgress.findMany({
      where: { userId, wordId: { in: wordIds } },
      select: { state: true, nextReviewAt: true },
    });
    return this.summarizeProgressRows(wordIds.length, rows);
  }

  // Pure aggregation over already-fetched rows — no query of its own, so
  // getLibraryProgress can reuse it per-deck against a partition of the one
  // library-wide query it already ran, rather than re-querying per deck.
  private summarizeProgressRows(
    totalWords: number,
    rows: { state: LearningState; nextReviewAt: Date }[],
  ): Omit<DeckProgressDto, 'deckId'> {
    if (totalWords === 0) {
      return {
        totalWords: 0,
        newWords: 0,
        learningWords: 0,
        reviewWords: 0,
        masteredWords: 0,
        dueWords: 0,
        startedPercent: 0,
        masteredPercent: 0,
      };
    }

    const now = new Date();
    let learningWords = 0;
    let reviewWords = 0;
    let masteredWords = 0;
    let dueWords = 0;

    // A persisted UserWordProgress row is never left in state NEW — the
    // lazy-creation transaction always applies the first rating's
    // transition in the same commit (see attemptReview) — so state !=
    // 'NEW' is guaranteed for every row returned here.
    for (const row of rows) {
      if (row.state === 'LEARNING' || row.state === 'RELEARNING')
        learningWords += 1;
      else if (row.state === 'REVIEW') reviewWords += 1;
      else if (row.state === 'MASTERED') masteredWords += 1;
      if (row.nextReviewAt <= now) dueWords += 1;
    }

    const newWords = totalWords - rows.length;
    // floor, not round — matches the sprint plan's own worked example
    // (15 total, 8 new -> 46%, not 47%).
    const startedPercent = Math.floor(
      ((totalWords - newWords) / totalWords) * 100,
    );
    // masteredPercent is a direct quality signal (unlike startedPercent,
    // which only measures exposure) — same floor convention for consistency.
    const masteredPercent = Math.floor((masteredWords / totalWords) * 100);

    return {
      totalWords,
      newWords,
      learningWords,
      reviewWords,
      masteredWords,
      dueWords,
      startedPercent,
      masteredPercent,
    };
  }

  // GET /learning/libraries/progress (Sprint 04D UI-repair follow-up) — one
  // row of summary progress per published library, for the library grid
  // (VocabLibraryPage). Deliberately NOT the per-deck breakdown shape
  // (LibraryProgressDto) — that's only needed once a student has opened a
  // specific library. Fixed query count regardless of how many libraries
  // exist: one deck-count groupBy, one visible-pairs fetch, one progress
  // fetch — never one query per library.
  async getLibrariesProgress(
    userId: string,
  ): Promise<LibrarySummaryProgressDto[]> {
    const libraries = await this.prisma.vocabLibrary.findMany({
      where: { isPublished: true },
      select: { id: true },
      orderBy: { orderIndex: 'asc' },
    });
    if (libraries.length === 0) return [];

    const deckCounts = await this.prisma.vocabDeck.groupBy({
      by: ['libraryId'],
      where: {
        isPublished: true,
        libraryId: { in: libraries.map((l) => l.id) },
      },
      _count: { _all: true },
    });
    const deckCountByLibrary = new Map(
      deckCounts.map((d) => [d.libraryId, d._count._all]),
    );

    // One visibility query covering every published library at once, not
    // one per library — same "raw pairs, then partition in memory"
    // technique getLibraryProgress already uses for its per-deck breakdown.
    const pairs = await this.prisma.vocabDeckWord.findMany({
      where: {
        deck: {
          isPublished: true,
          library: {
            isPublished: true,
            id: { in: libraries.map((l) => l.id) },
          },
        },
      },
      select: { wordId: true, deck: { select: { libraryId: true } } },
    });

    const wordIdsByLibrary = new Map<string, Set<string>>();
    for (const { wordId, deck } of pairs) {
      const set = wordIdsByLibrary.get(deck.libraryId);
      if (set) set.add(wordId);
      else wordIdsByLibrary.set(deck.libraryId, new Set([wordId]));
    }

    const allWordIds = [...new Set(pairs.map((p) => p.wordId))];
    const allProgress =
      allWordIds.length > 0
        ? await this.prisma.userWordProgress.findMany({
            where: { userId, wordId: { in: allWordIds } },
            select: { wordId: true, state: true, nextReviewAt: true },
          })
        : [];
    const progressByWordId = new Map(allProgress.map((p) => [p.wordId, p]));

    return libraries.map((library) => {
      const wordIds = [...(wordIdsByLibrary.get(library.id) ?? [])];
      const rows = wordIds
        .map((id) => progressByWordId.get(id))
        .filter((r): r is NonNullable<typeof r> => Boolean(r));
      return {
        libraryId: library.id,
        deckCount: deckCountByLibrary.get(library.id) ?? 0,
        ...this.summarizeProgressRows(wordIds.length, rows),
      };
    });
  }
}
