import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';
import { randomUUID } from 'crypto';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { VocabPersonalService } from './vocab-personal.service';
import {
  PersonalReviewIdempotencyKeyReusedException,
  PersonalWordAlreadyExistsException,
  PersonalWordVersionConflictException,
} from './vocab-personal.exceptions';

// Integration coverage against the real Postgres instance, same convention
// as learning.service.spec.ts (real $transaction atomicity, real
// unique-constraint races, real row-level locking) — a mock of PrismaService
// could not meaningfully prove any of those.
describe('VocabPersonalService (integration — real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: VocabPersonalService;

  const createdUserIds: string[] = [];

  const createUser = async (): Promise<string> => {
    const user = await prisma.user.create({
      data: {
        email: `vocab-personal-test-${randomUUID()}@example.test`,
        name: 'Vocab Personal Test User',
        password: 'irrelevant',
      },
    });
    createdUserIds.push(user.id);
    return user.id;
  };

  const baseWord = (overrides: Partial<{ text: string; meaningVi: string }> = {}) => ({
    text: overrides.text ?? `word-${randomUUID().slice(0, 8)}`,
    meaningVi: overrides.meaningVi ?? 'nghĩa tiếng việt',
  });

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    // AppModule includes SpeakingLiveGateway — app.init() over the full
    // module graph needs an explicit WS adapter or it throws. Same
    // registration learning.service.spec.ts uses for the same reason.
    app.useWebSocketAdapter(new WsAdapter(app));
    await app.init();
    prisma = app.get(PrismaService);
    service = app.get(VocabPersonalService);
  }, 30000);

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await moduleRef.close();
  }, 30000);

  describe('create + dedup', () => {
    it('creates a word with a computed textNormalized', async () => {
      const userId = await createUser();
      const dto = baseWord({ text: '  Abandon  ' });

      const created = await service.create(userId, dto);

      expect(created.text).toBe('  Abandon  ');
      const row = await prisma.personalVocabWord.findUniqueOrThrow({
        where: { id: created.id },
      });
      expect(row.textNormalized).toBe('abandon');
      expect(row.state).toBe('NEW');
    });

    it('rejects a second word that normalizes to the same text for the same user', async () => {
      const userId = await createUser();
      await service.create(userId, baseWord({ text: 'Apple' }));

      await expect(
        service.create(userId, baseWord({ text: ' apple ' })),
      ).rejects.toBeInstanceOf(PersonalWordAlreadyExistsException);
    });

    it('allows the SAME text for two DIFFERENT users — the unique constraint is per-user', async () => {
      const userA = await createUser();
      const userB = await createUser();

      await expect(
        service.create(userA, baseWord({ text: 'shared-word' })),
      ).resolves.toBeDefined();
      await expect(
        service.create(userB, baseWord({ text: 'shared-word' })),
      ).resolves.toBeDefined();
    });
  });

  describe('bulkCreate — race-safe dedup (owner review point C)', () => {
    it('dedups against an existing row without failing the whole batch', async () => {
      const userId = await createUser();
      await service.create(userId, baseWord({ text: 'existing' }));

      const result = await service.bulkCreate(userId, {
        words: [baseWord({ text: 'EXISTING' }), baseWord({ text: 'brandnew' })],
      });

      expect(result.createdCount).toBe(1);
      expect(result.skippedCount).toBe(1);
      expect(result.skippedWords).toEqual(['EXISTING']);
    });

    it('dedups an intra-batch duplicate pair (two paste lines normalizing the same), not just a pre-existing row', async () => {
      const userId = await createUser();

      const result = await service.bulkCreate(userId, {
        words: [
          baseWord({ text: 'Twice' }),
          baseWord({ text: 'twice' }),
          baseWord({ text: 'once' }),
        ],
      });

      expect(result.createdCount).toBe(2);
      expect(result.skippedCount).toBe(1);
      expect(result.skippedWords).toEqual(['twice']);

      const total = await prisma.personalVocabWord.count({ where: { userId } });
      expect(total).toBe(2);
    });

    it('never throws a raw Prisma error for a duplicate — always the structured createdCount/skippedCount/skippedWords contract', async () => {
      const userId = await createUser();

      await expect(
        service.bulkCreate(userId, {
          words: [baseWord({ text: 'dup' }), baseWord({ text: 'dup' })],
        }),
      ).resolves.toEqual(
        expect.objectContaining({ createdCount: 1, skippedCount: 1 }),
      );
    });
  });

  describe('ownership (owner review point B)', () => {
    it('update() 404s on another user\'s word id rather than leaking it', async () => {
      const owner = await createUser();
      const attacker = await createUser();
      const word = await service.create(owner, baseWord());

      await expect(
        service.update(attacker, word.id, { meaningVi: 'hacked' }),
      ).rejects.toBeInstanceOf(NotFoundException);

      const untouched = await prisma.personalVocabWord.findUniqueOrThrow({
        where: { id: word.id },
      });
      expect(untouched.meaningVi).toBe(word.meaningVi);
    });

    it('remove() 404s on another user\'s word id and does not delete it', async () => {
      const owner = await createUser();
      const attacker = await createUser();
      const word = await service.create(owner, baseWord());

      await expect(service.remove(attacker, word.id)).rejects.toBeInstanceOf(
        NotFoundException,
      );

      await expect(
        prisma.personalVocabWord.findUniqueOrThrow({ where: { id: word.id } }),
      ).resolves.toBeDefined();
    });

    it('submitReview() 404s on another user\'s word id', async () => {
      const owner = await createUser();
      const attacker = await createUser();
      const word = await service.create(owner, baseWord());

      await expect(
        service.submitReview(attacker, word.id, {
          rating: 'GOOD',
          clientReviewId: randomUUID(),
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('review scheduling — reuses the real scheduler (next())', () => {
    it('a GOOD rating on a NEW word graduates it and sets a future nextReviewAt', async () => {
      const userId = await createUser();
      const word = await service.create(userId, baseWord());

      const result = await service.submitReview(userId, word.id, {
        rating: 'GOOD',
        clientReviewId: randomUUID(),
      });

      expect(result.state).toBe('REVIEW');
      expect(result.intervalDays).toBeGreaterThan(0);
      expect(result.nextReviewAt.getTime()).toBeGreaterThan(Date.now());
      expect(result.version).toBe(1);

      const row = await prisma.personalVocabWord.findUniqueOrThrow({
        where: { id: word.id },
      });
      expect(row.version).toBe(1);
      expect(row.lastReviewedAt).not.toBeNull();
    });

    it('a retried clientReviewId returns the ORIGINAL recorded outcome, never re-scheduling', async () => {
      const userId = await createUser();
      const word = await service.create(userId, baseWord());
      const clientReviewId = randomUUID();

      const first = await service.submitReview(userId, word.id, {
        rating: 'GOOD',
        clientReviewId,
      });
      const replay = await service.submitReview(userId, word.id, {
        rating: 'GOOD',
        clientReviewId,
      });

      expect(replay).toEqual(first);
      const logCount = await prisma.personalWordReviewLog.count({
        where: { userId, personalWordId: word.id },
      });
      expect(logCount).toBe(1); // no second row from the replay
    });

    it('the same clientReviewId against a DIFFERENT word throws the idempotency-reuse exception', async () => {
      const userId = await createUser();
      const wordA = await service.create(userId, baseWord());
      const wordB = await service.create(userId, baseWord());
      const clientReviewId = randomUUID();

      await service.submitReview(userId, wordA.id, { rating: 'GOOD', clientReviewId });

      await expect(
        service.submitReview(userId, wordB.id, { rating: 'GOOD', clientReviewId }),
      ).rejects.toBeInstanceOf(PersonalReviewIdempotencyKeyReusedException);
    });

    it('two concurrent ratings computed from the SAME stale version: exactly one succeeds, the other gets an immediate version conflict (no retry, matching LearningService\'s update-race behaviour)', async () => {
      // A real HTTP race is two nearly-simultaneous requests each doing
      // their own fetch-then-write; on a fast local DB with no network
      // latency, two `service.submitReview()` calls fired via
      // Promise.allSettled reliably run start-to-finish one after the
      // other rather than genuinely overlapping (verified — both simply
      // succeed in sequence). To exercise the actual race deterministically,
      // this fetches the word ONCE and drives the private attemptReview
      // step twice from that SAME stale snapshot — exactly what two
      // requests that both fetched before either wrote would each compute.
      const userId = await createUser();
      const word = await service.create(userId, baseWord());
      const staleRow = await prisma.personalVocabWord.findUniqueOrThrow({
        where: { id: word.id },
      });

      const attemptReview = (
        service as unknown as {
          attemptReview: (
            userId: string,
            row: typeof staleRow,
            dto: { rating: 'GOOD' | 'EASY'; clientReviewId: string },
          ) => Promise<unknown>;
        }
      ).attemptReview.bind(service);

      const results = await Promise.allSettled([
        attemptReview(userId, staleRow, { rating: 'GOOD', clientReviewId: randomUUID() }),
        attemptReview(userId, staleRow, { rating: 'EASY', clientReviewId: randomUUID() }),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
        PersonalWordVersionConflictException,
      );
    });
  });

  describe('getSavedStatus — the universal save-star\'s read path', () => {
    it('returns an empty object for an empty input, no query issued', async () => {
      const userId = await createUser();
      await expect(service.getSavedStatus(userId, [])).resolves.toEqual({});
    });

    it('reports saved:true with the real id for a saved word, saved:false for an unsaved one', async () => {
      const userId = await createUser();
      const saved = await service.create(userId, baseWord({ text: 'Persisted' }));

      const status = await service.getSavedStatus(userId, ['Persisted', 'never-saved']);

      expect(status['persisted']).toEqual({ saved: true, id: saved.id });
      expect(status['never-saved']).toEqual({ saved: false });
    });

    it('matches case/whitespace-insensitively, same normalization as create()', async () => {
      const userId = await createUser();
      const saved = await service.create(userId, baseWord({ text: 'apple' }));

      const status = await service.getSavedStatus(userId, ['  APPLE  ']);

      expect(status['apple']).toEqual({ saved: true, id: saved.id });
    });

    it('dedups repeated texts in the input into one key', async () => {
      const userId = await createUser();
      await service.create(userId, baseWord({ text: 'dupe-check' }));

      const status = await service.getSavedStatus(userId, ['dupe-check', 'Dupe-Check', ' dupe-check ']);

      expect(Object.keys(status)).toEqual(['dupe-check']);
    });

    it('never reports another user\'s word as saved, even with an identical text', async () => {
      const userA = await createUser();
      const userB = await createUser();
      await service.create(userA, baseWord({ text: 'shared-status-word' }));

      const status = await service.getSavedStatus(userB, ['shared-status-word']);

      expect(status['shared-status-word']).toEqual({ saved: false });
    });
  });

  describe('list — dueOnly', () => {
    it('matches getStats\' dueTodayCount exactly: includes never-reviewed words, excludes a word due tomorrow', async () => {
      const userId = await createUser();
      const dueNow = await service.create(userId, baseWord()); // NEW — due immediately
      const dueLater = await service.create(userId, baseWord());
      await service.submitReview(userId, dueLater.id, {
        rating: 'EASY', // graduates far enough out to land after tomorrow
        clientReviewId: randomUUID(),
      });

      const stats = await service.getStats(userId, 'UTC');
      const dueOnlyList = await service.list(userId, { dueOnly: true, tz: 'UTC' });

      expect(dueOnlyList.meta.total).toBe(stats.dueTodayCount);
      expect(dueOnlyList.data.map((w) => w.id)).toContain(dueNow.id);
      expect(dueOnlyList.data.map((w) => w.id)).not.toContain(dueLater.id);
    });

    it('composes correctly with a search query (AND, not a clobbered OR)', async () => {
      const userId = await createUser();
      const match = await service.create(userId, baseWord({ text: 'duesearchmatch' }));
      await service.create(userId, baseWord({ text: 'nomatch' }));

      const result = await service.list(userId, { dueOnly: true, q: 'duesearch', tz: 'UTC' });

      expect(result.data.map((w) => w.id)).toEqual([match.id]);
    });
  });

  describe('getStats', () => {
    it('buckets NEW/LEARNING+REVIEW+RELEARNING/MASTERED correctly and counts struggled words (lapses > 0)', async () => {
      const userId = await createUser();
      const untouched = await service.create(userId, baseWord());
      const learning = await service.create(userId, baseWord());
      await service.submitReview(userId, learning.id, {
        rating: 'GOOD',
        clientReviewId: randomUUID(),
      });
      const struggled = await service.create(userId, baseWord());
      // A NEW word rated AGAIN does NOT count as a lapse — see
      // scheduler.ts's `next()`: lapses only increment on the REVIEW/
      // MASTERED -> RELEARNING edge, deliberately not on ordinary
      // first-time learning. Graduate it with GOOD first, then AGAIN to
      // produce a genuine lapse.
      await service.submitReview(userId, struggled.id, {
        rating: 'GOOD',
        clientReviewId: randomUUID(),
      });
      await service.submitReview(userId, struggled.id, {
        rating: 'AGAIN',
        clientReviewId: randomUUID(),
      });

      const stats = await service.getStats(userId, 'UTC');

      expect(stats.total).toBe(3);
      expect(stats.new).toBe(1);
      expect(stats.learning).toBe(2); // GOOD->REVIEW and AGAIN->LEARNING both count
      expect(stats.mastered).toBe(0);
      expect(stats.struggledCount).toBe(1);
      expect(untouched.state).toBe('NEW');
    });

    it('dueTodayCount includes never-reviewed (NEW) words immediately — deliberately unlike getDueReviews', async () => {
      const userId = await createUser();
      await service.create(userId, baseWord());

      const stats = await service.getStats(userId, 'UTC');

      expect(stats.dueTodayCount).toBe(1);
    });

    it('reviewsLast7Days has exactly 7 ascending day buckets ending today, with real counts', async () => {
      const userId = await createUser();
      const word = await service.create(userId, baseWord());
      await service.submitReview(userId, word.id, {
        rating: 'GOOD',
        clientReviewId: randomUUID(),
      });

      const stats = await service.getStats(userId, 'UTC');

      expect(stats.reviewsLast7Days).toHaveLength(7);
      const dates = stats.reviewsLast7Days.map((d) => d.date);
      expect([...dates].sort()).toEqual(dates);
      const total = stats.reviewsLast7Days.reduce((sum, d) => sum + d.count, 0);
      expect(total).toBe(1);
    });
  });
});
