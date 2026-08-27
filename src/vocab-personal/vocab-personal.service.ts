import { Injectable, NotFoundException } from '@nestjs/common';
import { LearningState, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { startOfDayInTimeZone } from '../learning/timezone.util';
import { enumerateDaysInTimeZone, formatDayInTimeZone } from '../analytics/day-window';
import { next as schedulerNext, ProgressSnapshot } from '../learning/srs/scheduler';
import { CreatePersonalVocabWordDto } from './dto/create-personal-vocab-word.dto';
import { UpdatePersonalVocabWordDto } from './dto/update-personal-vocab-word.dto';
import { BulkCreatePersonalVocabWordsDto } from './dto/bulk-create-personal-vocab-words.dto';
import {
  QueryPersonalVocabWordsDto,
  PersonalWordStatusFilter,
  PersonalWordSort,
} from './dto/query-personal-vocab-words.dto';
import { SubmitPersonalWordReviewDto } from './dto/submit-personal-word-review.dto';
import {
  PersonalReviewIdempotencyKeyReusedException,
  PersonalWordAlreadyExistsException,
  PersonalWordVersionConflictException,
} from './vocab-personal.exceptions';
import {
  BulkCreatePersonalVocabWordsResponseDto,
  PersonalVocabStatsDto,
  PersonalVocabWordDto,
  PersonalVocabWordListResponseDto,
  PersonalVocabWordSavedStatusDto,
  PersonalWordReviewResponseDto,
} from './vocab-personal.types';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
// "In progress" for the mockup's 4 stat cards — see
// query-personal-vocab-words.dto.ts's PersonalWordStatusFilter comment for
// why LearningState's 5 real values collapse into 3 presentation buckets.
const LEARNING_BUCKET_STATES: LearningState[] = ['LEARNING', 'REVIEW', 'RELEARNING'];

// Module-local narrowing helper, same idiom as auth.service.ts/
// learning.service.ts/community-chat.service.ts (each keeps its own copy
// rather than a shared util — this codebase's established convention for
// this exact one-liner).
const isUniqueConstraintViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

const normalizeText = (text: string): string => text.trim().toLowerCase();

type PersonalVocabWordRow = Awaited<
  ReturnType<PrismaService['personalVocabWord']['findFirstOrThrow']>
>;

const toDto = (row: PersonalVocabWordRow): PersonalVocabWordDto => ({
  id: row.id,
  text: row.text,
  ipa: row.ipa,
  meaningVi: row.meaningVi,
  meaningEn: row.meaningEn,
  audioUrl: row.audioUrl,
  exampleSentence: row.exampleSentence,
  exampleTranslation: row.exampleTranslation,
  tags: row.tags,
  state: row.state,
  easeFactor: row.easeFactor,
  intervalDays: row.intervalDays,
  repetitions: row.repetitions,
  lapses: row.lapses,
  nextReviewAt: row.nextReviewAt,
  firstLearnedAt: row.firstLearnedAt,
  masteredAt: row.masteredAt,
  version: row.version,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const toProgressSnapshot = (row: PersonalVocabWordRow): ProgressSnapshot => ({
  state: row.state,
  easeFactor: row.easeFactor,
  intervalDays: row.intervalDays,
  repetitions: row.repetitions,
  lapses: row.lapses,
  masteredAt: row.masteredAt,
  firstLearnedAt: row.firstLearnedAt,
});

const statusFilterWhere = (
  status: PersonalWordStatusFilter | undefined,
): Prisma.PersonalVocabWordWhereInput => {
  switch (status) {
    case 'new':
      return { state: 'NEW' };
    case 'learning':
      return { state: { in: LEARNING_BUCKET_STATES } };
    case 'mastered':
      return { state: 'MASTERED' };
    default:
      return {};
  }
};

const sortOrderBy = (
  sort: PersonalWordSort | undefined,
): Prisma.PersonalVocabWordOrderByWithRelationInput => {
  switch (sort) {
    case 'oldest':
      return { createdAt: 'asc' };
    case 'alphabetical':
      return { text: 'asc' };
    case 'newest':
    default:
      return { createdAt: 'desc' };
  }
};

@Injectable()
export class VocabPersonalService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    userId: string,
    query: QueryPersonalVocabWordsDto,
  ): Promise<PersonalVocabWordListResponseDto> {
    const take = Math.min(query.limit || DEFAULT_LIMIT, MAX_LIMIT);
    const page = query.page ?? 1;
    const skip = (page - 1) * take;

    // Each optional filter that itself needs an OR (search, dueOnly) is its
    // own entry in `AND`, never a second top-level `OR` key spread onto the
    // same object — two `...(cond && { OR: [...] })` spreads on one object
    // literal would silently let the second overwrite the first's `OR`.
    const andConditions: Prisma.PersonalVocabWordWhereInput[] = [];
    if (query.q) {
      andConditions.push({
        OR: [
          { textNormalized: { contains: normalizeText(query.q) } },
          { meaningVi: { contains: query.q, mode: 'insensitive' as const } },
        ],
      });
    }
    if (query.dueOnly) {
      const tomorrowStart = await this.resolveTomorrowStart(userId, query.tz);
      andConditions.push({
        OR: [{ nextReviewAt: null }, { nextReviewAt: { lt: tomorrowStart } }],
      });
    }

    const where: Prisma.PersonalVocabWordWhereInput = {
      userId,
      ...statusFilterWhere(query.status),
      ...(query.tag && { tags: { has: query.tag } }),
      ...(andConditions.length > 0 && { AND: andConditions }),
    };

    const [words, total] = await Promise.all([
      this.prisma.personalVocabWord.findMany({
        where,
        skip,
        take,
        orderBy: sortOrderBy(query.sort),
      }),
      this.prisma.personalVocabWord.count({ where }),
    ]);

    return {
      data: words.map(toDto),
      meta: { total, page, limit: take, totalPages: Math.ceil(total / take) },
    };
  }

  // Batch "is this word already saved" check — the universal save-star's
  // read path (see DictionaryPanel/DeckDetailPage/WordDetailPage/
  // FlashcardSession on the frontend). One indexed query regardless of how
  // many texts are asked about; ownership is automatic since the WHERE is
  // scoped to `userId` from the start, same shape as `list()`.
  async getSavedStatus(
    userId: string,
    texts: string[],
  ): Promise<PersonalVocabWordSavedStatusDto> {
    const normalizedTexts = [...new Set(texts.map(normalizeText))];
    if (normalizedTexts.length === 0) return {};

    const rows = await this.prisma.personalVocabWord.findMany({
      where: { userId, textNormalized: { in: normalizedTexts } },
      select: { id: true, textNormalized: true },
    });
    const idByNormalized = new Map(rows.map((row) => [row.textNormalized, row.id]));

    const result: PersonalVocabWordSavedStatusDto = {};
    for (const normalized of normalizedTexts) {
      const id = idByNormalized.get(normalized);
      result[normalized] = id ? { saved: true, id } : { saved: false };
    }
    return result;
  }

  async create(
    userId: string,
    dto: CreatePersonalVocabWordDto,
  ): Promise<PersonalVocabWordDto> {
    try {
      const row = await this.prisma.personalVocabWord.create({
        data: {
          userId,
          text: dto.text,
          textNormalized: normalizeText(dto.text),
          ipa: dto.ipa,
          meaningVi: dto.meaningVi,
          meaningEn: dto.meaningEn,
          audioUrl: dto.audioUrl,
          exampleSentence: dto.exampleSentence,
          exampleTranslation: dto.exampleTranslation,
          tags: dto.tags ?? [],
        },
      });
      return toDto(row);
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throw new PersonalWordAlreadyExistsException();
      }
      throw error;
    }
  }

  // Race-safe by construction (owner review point C): the database's
  // @@unique([userId, textNormalized]) constraint is the actual source of
  // truth for "does this word already exist", not a check-then-insert.
  //
  // Deliberately NOT one shared $transaction around the loop. Postgres
  // aborts an ENTIRE transaction on its first error and refuses every
  // further statement in it ("current transaction is aborted") until a
  // rollback — Prisma exposes no savepoint to recover from inside one, so a
  // per-row try/catch INSIDE a shared transaction cannot work here. This is
  // the exact hazard StudyTimeService's own comment warns about ("a failed
  // statement aborts the whole transaction... a catch could not recover").
  // Each word is instead created as its OWN independent top-level `create()`
  // — its own implicit transaction — so a caught P2002 (a duplicate against
  // an existing row, two duplicate lines in the same paste, or a genuine
  // concurrent double-submit) only ever aborts THAT ONE insert, never the
  // rest of the batch.
  async bulkCreate(
    userId: string,
    dto: BulkCreatePersonalVocabWordsDto,
  ): Promise<BulkCreatePersonalVocabWordsResponseDto> {
    const seenInBatch = new Set<string>();
    const skippedWords: string[] = [];
    const toInsert: { input: CreatePersonalVocabWordDto; textNormalized: string }[] = [];

    for (const input of dto.words) {
      const textNormalized = normalizeText(input.text);
      if (seenInBatch.has(textNormalized)) {
        skippedWords.push(input.text);
        continue;
      }
      seenInBatch.add(textNormalized);
      toInsert.push({ input, textNormalized });
    }

    let createdCount = 0;
    for (const { input, textNormalized } of toInsert) {
      try {
        await this.prisma.personalVocabWord.create({
          data: {
            userId,
            text: input.text,
            textNormalized,
            ipa: input.ipa,
            meaningVi: input.meaningVi,
            meaningEn: input.meaningEn,
            audioUrl: input.audioUrl,
            exampleSentence: input.exampleSentence,
            exampleTranslation: input.exampleTranslation,
            tags: input.tags ?? [],
          },
        });
        createdCount += 1;
      } catch (error) {
        if (!isUniqueConstraintViolation(error)) throw error;
        skippedWords.push(input.text);
      }
    }

    return { createdCount, skippedCount: skippedWords.length, skippedWords };
  }

  // Ownership enforced structurally: `updateMany`/`deleteMany` scoped
  // `where: { id, userId }` directly, never a bare findUnique-by-id followed
  // by an app-level owner comparison (owner review point B). `count === 0`
  // means "not found OR not yours" — both produce an identical 404, so this
  // endpoint never confirms another user's word exists.
  async update(
    userId: string,
    id: string,
    dto: UpdatePersonalVocabWordDto,
  ): Promise<PersonalVocabWordDto> {
    const data: Prisma.PersonalVocabWordUpdateManyMutationInput = { ...dto };
    if (dto.text !== undefined) {
      data.textNormalized = normalizeText(dto.text);
    }

    try {
      const result = await this.prisma.personalVocabWord.updateMany({
        where: { id, userId },
        data,
      });
      if (result.count === 0) {
        throw new NotFoundException('Personal vocabulary word not found');
      }
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throw new PersonalWordAlreadyExistsException();
      }
      throw error;
    }

    // Re-fetch scoped by the same (id, userId) pair — the row is guaranteed
    // to exist and belong to this user at this point (updateMany above
    // already proved it), so findFirstOrThrow's only realistic failure mode
    // here is a genuine bug, not a race a caller needs to handle.
    const row = await this.prisma.personalVocabWord.findFirstOrThrow({
      where: { id, userId },
    });
    return toDto(row);
  }

  async remove(userId: string, id: string): Promise<void> {
    const result = await this.prisma.personalVocabWord.deleteMany({
      where: { id, userId },
    });
    if (result.count === 0) {
      throw new NotFoundException('Personal vocabulary word not found');
    }
  }

  async submitReview(
    userId: string,
    id: string,
    dto: SubmitPersonalWordReviewDto,
  ): Promise<PersonalWordReviewResponseDto> {
    const existingLog = await this.prisma.personalWordReviewLog.findUnique({
      where: {
        userId_clientReviewId: { userId, clientReviewId: dto.clientReviewId },
      },
    });

    if (existingLog) {
      if (existingLog.personalWordId !== id || existingLog.rating !== dto.rating) {
        throw new PersonalReviewIdempotencyKeyReusedException();
      }
      // A replay earns nothing new — return the word's current snapshot,
      // same "no fabricated re-computation" discipline as
      // LearningService.submitReview's replay branch.
      const word = await this.prisma.personalVocabWord.findFirst({
        where: { id, userId },
      });
      if (!word) throw new NotFoundException('Personal vocabulary word not found');
      return {
        state: word.state,
        intervalDays: word.intervalDays,
        nextReviewAt: word.nextReviewAt ?? new Date(),
        easeFactor: word.easeFactor,
        repetitions: word.repetitions,
        lapses: word.lapses,
        version: word.version,
      };
    }

    // Ownership-scoped fetch, reached only on a fresh submission — closes
    // the same gap update()/remove() close via updateMany, for the one
    // endpoint that can't use a bare updateMany because it needs the row's
    // current SRS fields to compute the next state first.
    const word = await this.prisma.personalVocabWord.findFirst({
      where: { id, userId },
    });
    if (!word) throw new NotFoundException('Personal vocabulary word not found');

    return this.attemptReview(userId, word, dto);
  }

  // No retry loop here, matching LearningService.attemptReview's ACTUAL
  // behaviour for an already-existing row (as opposed to its lazy-create
  // race, which does get one bounded retry): a version conflict on update
  // throws immediately. A PersonalVocabWord is never lazily created — it
  // must already exist before any review is submitted — so there is no
  // create-race equivalent to retry into here at all.
  private async attemptReview(
    userId: string,
    word: PersonalVocabWordRow,
    dto: SubmitPersonalWordReviewDto,
  ): Promise<PersonalWordReviewResponseDto> {
    const before: ProgressSnapshot = toProgressSnapshot(word);
    const now = new Date();
    const result = schedulerNext(before, dto.rating, now);

    return this.prisma.$transaction(async (tx) => {
      const updateResult = await tx.personalVocabWord.updateMany({
        where: { id: word.id, version: word.version },
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
      if (updateResult.count === 0) {
        throw new PersonalWordVersionConflictException();
      }

      await tx.personalWordReviewLog.create({
        data: {
          userId,
          personalWordId: word.id,
          rating: dto.rating,
          clientReviewId: dto.clientReviewId,
          reviewedAt: now,
        },
      });

      return {
        state: result.state,
        intervalDays: result.intervalDays,
        nextReviewAt: result.nextReviewAt,
        easeFactor: result.easeFactor,
        repetitions: result.repetitions,
        lapses: result.lapses,
        version: word.version + 1,
      };
    });
  }

  // The exclusive upper bound of "today" in the user's own zone — shared by
  // getStats' dueTodayCount and list()'s dueOnly filter so the sidebar's
  // count and its actual session list can never disagree. Reuses
  // startOfDayInTimeZone rather than inventing new timezone math (owner
  // review point on dueTodayCount): the local midnight of the day AFTER
  // `now` is exactly that boundary.
  private async resolveTomorrowStart(userId: string, tz: string | undefined): Promise<Date> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { timezone: true },
    });
    const effectiveTz = tz ?? user.timezone ?? 'UTC';
    return startOfDayInTimeZone(new Date(Date.now() + 24 * 60 * 60 * 1000), effectiveTz);
  }

  async getStats(userId: string, tz: string | undefined): Promise<PersonalVocabStatsDto> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { timezone: true },
    });
    const effectiveTz = tz ?? user.timezone ?? 'UTC';
    const now = new Date();
    const tomorrowStart = startOfDayInTimeZone(
      new Date(now.getTime() + 24 * 60 * 60 * 1000),
      effectiveTz,
    );
    const sevenDaysAgoStart = startOfDayInTimeZone(
      new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000),
      effectiveTz,
    );

    const [total, mastered, learning, newCount, dueTodayCount, struggledCount, reviewRows] =
      await Promise.all([
        this.prisma.personalVocabWord.count({ where: { userId } }),
        this.prisma.personalVocabWord.count({ where: { userId, state: 'MASTERED' } }),
        this.prisma.personalVocabWord.count({
          where: { userId, state: { in: LEARNING_BUCKET_STATES } },
        }),
        this.prisma.personalVocabWord.count({ where: { userId, state: 'NEW' } }),
        // Deliberately includes never-reviewed (nextReviewAt = null) words —
        // unlike getDueReviews' NEW-state exclusion/daily-introduction quota,
        // which paces an admin-curated deck. A personal word is user-
        // initiated (typed or pasted in deliberately) and should be
        // reviewable immediately.
        this.prisma.personalVocabWord.count({
          where: {
            userId,
            OR: [{ nextReviewAt: null }, { nextReviewAt: { lt: tomorrowStart } }],
          },
        }),
        this.prisma.personalVocabWord.count({ where: { userId, lapses: { gt: 0 } } }),
        this.prisma.personalWordReviewLog.findMany({
          where: { userId, reviewedAt: { gte: sevenDaysAgoStart, lt: tomorrowStart } },
          select: { reviewedAt: true },
        }),
      ]);

    const days = enumerateDaysInTimeZone(now, effectiveTz, 7);
    const countsByDay = new Map<string, number>(days.map((d) => [d, 0]));
    for (const row of reviewRows) {
      const day = formatDayInTimeZone(row.reviewedAt, effectiveTz);
      countsByDay.set(day, (countsByDay.get(day) ?? 0) + 1);
    }

    return {
      total,
      mastered,
      learning,
      new: newCount,
      dueTodayCount,
      struggledCount,
      reviewsLast7Days: days.map((date) => ({ date, count: countsByDay.get(date) ?? 0 })),
    };
  }
}
