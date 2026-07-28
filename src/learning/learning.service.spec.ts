import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { LearningService } from './learning.service';
import { VocabWordService } from '../vocab-word/vocab-word.service';
import {
  IdempotencyKeyReusedException,
  ReviewVersionConflictException,
} from './learning.exceptions';
import { testFixtureName } from '../../test/test-database.util';

// Sprint 04B — integration coverage against the real Postgres instance
// (docker-compose.yml), matching this codebase's existing convention for
// anything that can't be meaningfully exercised through a mock (real
// $transaction atomicity, real unique-constraint races, real row-level
// locking under concurrent updates) — the same reasoning
// refresh-token.service.spec.ts already established for real-Redis-only
// concurrency proofs. Requires `docker-compose up -d` from
// engmasterai-backend/.
//
// NOTE (Sprint 04D): despite the `.spec.ts` name and living in `src/`
// alongside unit specs, this file is a DB-backed INTEGRATION test, not a
// unit test — it boots the full AppModule and writes real rows. It runs
// under `npm run test` regardless, so that command now requires Postgres up
// and a correctly configured `.env.test` (see test/test-database.util.ts).
// This is called out explicitly, not fixed here, because splitting DB-backed
// specs out of the unit run is its own change — see docs/memory.md's Known
// Technical Debt for this sprint.
//
// Every library/deck/word this file creates is named through
// `testFixtureName()` (test/test-database.util.ts) so a global sweep can
// find and remove it even if a run is interrupted before its own `afterAll`
// runs — the exact gap that once let published fixture rows survive into a
// real database (see docs/memory.md's Sprint 04D entry).
describe('LearningService (integration — real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: LearningService;
  let vocabWordService: VocabWordService;

  const createdUserIds: string[] = [];
  let libraryId: string;
  let deckId: string;
  let wordId: string;
  let hiddenDeckId: string;
  let hiddenWordId: string;

  const createUser = async (): Promise<string> => {
    const user = await prisma.user.create({
      data: {
        email: `learning-test-${randomUUID()}@example.test`,
        name: 'Learning Test User',
        password: 'irrelevant',
      },
    });
    createdUserIds.push(user.id);
    return user.id;
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    service = app.get(LearningService);
    vocabWordService = app.get(VocabWordService);

    const library = await prisma.vocabLibrary.create({
      data: {
        name: testFixtureName('Learning Test Library'),
        description: 'fixture',
        orderIndex: 0,
        isPublished: true,
      },
    });
    libraryId = library.id;

    const deck = await prisma.vocabDeck.create({
      data: {
        libraryId,
        name: testFixtureName('Learning Test Deck'),
        orderIndex: 0,
        isPublished: true,
      },
    });
    deckId = deck.id;

    const word = await prisma.vocabWord.create({
      data: {
        text: testFixtureName('learning-test-word'),
        meanings: { create: [{ meaning: 'a fixture word', orderIndex: 0 }] },
      },
    });
    wordId = word.id;
    await prisma.vocabDeckWord.create({
      data: { deckId, wordId, orderIndex: 0 },
    });

    const hiddenDeck = await prisma.vocabDeck.create({
      data: {
        libraryId,
        name: testFixtureName('Learning Test Hidden Deck'),
        orderIndex: 1,
        isPublished: false,
      },
    });
    hiddenDeckId = hiddenDeck.id;

    const hiddenWord = await prisma.vocabWord.create({
      data: {
        text: testFixtureName('learning-test-hidden-word'),
        meanings: {
          create: [{ meaning: 'a hidden fixture word', orderIndex: 0 }],
        },
      },
    });
    hiddenWordId = hiddenWord.id;
    await prisma.vocabDeckWord.create({
      data: { deckId: hiddenDeckId, wordId: hiddenWordId, orderIndex: 0 },
    });
  }, 30000);

  afterAll(async () => {
    // Users first — User cascades to UserWordProgress/WordReviewLog, which
    // is what makes the words themselves deletable afterward (both word
    // relations are Restrict while any learning history exists — §4/§5/§17).
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await prisma.vocabDeckWord.deleteMany({
      where: { deckId: { in: [deckId, hiddenDeckId] } },
    });
    await prisma.vocabWord.deleteMany({
      where: { id: { in: [wordId, hiddenWordId] } },
    });
    await prisma.vocabDeck.deleteMany({
      where: { id: { in: [deckId, hiddenDeckId] } },
    });
    await prisma.vocabLibrary.delete({ where: { id: libraryId } });
    await moduleRef.close();
  }, 30000);

  describe('idempotency (§10)', () => {
    it('a retried clientReviewId returns the ORIGINAL recorded outcome, not whatever progress currently looks like — the reported regression', async () => {
      const userId = await createUser();
      const idA = randomUUID();
      const idB = randomUUID();

      const respA = await service.submitReview(userId, wordId, {
        rating: 'GOOD',
        practiceMode: 'FLASHCARD',
        clientReviewId: idA,
      });
      const respB = await service.submitReview(userId, wordId, {
        rating: 'EASY',
        practiceMode: 'FLASHCARD',
        clientReviewId: idB,
      });
      expect(respB.version).not.toBe(respA.version);

      const replayOfA = await service.submitReview(userId, wordId, {
        rating: 'GOOD',
        practiceMode: 'FLASHCARD',
        clientReviewId: idA,
      });

      expect(replayOfA).toEqual(respA); // NOT respB's state
    });

    it('the same clientReviewId with a different rating throws IdempotencyKeyReusedException, never silently reprocessing', async () => {
      const userId = await createUser();
      const id = randomUUID();
      await service.submitReview(userId, wordId, {
        rating: 'GOOD',
        practiceMode: 'FLASHCARD',
        clientReviewId: id,
      });

      await expect(
        service.submitReview(userId, wordId, {
          rating: 'EASY',
          practiceMode: 'FLASHCARD',
          clientReviewId: id,
        }),
      ).rejects.toThrow(IdempotencyKeyReusedException);
    });

    it('the same clientReviewId with a different practiceMode also throws IdempotencyKeyReusedException', async () => {
      const userId = await createUser();
      const id = randomUUID();
      await service.submitReview(userId, wordId, {
        rating: 'GOOD',
        practiceMode: 'FLASHCARD',
        clientReviewId: id,
      });

      await expect(
        service.submitReview(userId, wordId, {
          rating: 'GOOD',
          practiceMode: 'DICTATION',
          clientReviewId: id,
        }),
      ).rejects.toThrow(IdempotencyKeyReusedException);
    });
  });

  describe('concurrency (§10/§11)', () => {
    it('two concurrent first-ratings for the same (user, word): one via create, one via a single bounded retry — never two errors, never an unbounded retry', async () => {
      const userId = await createUser();

      const [r1, r2] = await Promise.all([
        service.submitReview(userId, wordId, {
          rating: 'GOOD',
          practiceMode: 'FLASHCARD',
          clientReviewId: randomUUID(),
        }),
        service.submitReview(userId, wordId, {
          rating: 'GOOD',
          practiceMode: 'FLASHCARD',
          clientReviewId: randomUUID(),
        }),
      ]);

      expect(r1).toBeDefined();
      expect(r2).toBeDefined();

      const progress = await prisma.userWordProgress.findUnique({
        where: { userId_wordId: { userId, wordId } },
      });
      expect(progress).not.toBeNull();
      expect(progress!.version).toBe(2); // both reviews applied, exactly once each

      const logCount = await prisma.wordReviewLog.count({
        where: { userId, wordId },
      });
      expect(logCount).toBe(2);
    });

    it('two concurrent ratings against an ALREADY-existing progress row: exactly one succeeds, the other gets a version conflict (distinct from an idempotency conflict)', async () => {
      const userId = await createUser();
      await service.submitReview(userId, wordId, {
        rating: 'GOOD',
        practiceMode: 'FLASHCARD',
        clientReviewId: randomUUID(),
      });

      const results = await Promise.allSettled([
        service.submitReview(userId, wordId, {
          rating: 'GOOD',
          practiceMode: 'FLASHCARD',
          clientReviewId: randomUUID(),
        }),
        service.submitReview(userId, wordId, {
          rating: 'EASY',
          practiceMode: 'FLASHCARD',
          clientReviewId: randomUUID(),
        }),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(ReviewVersionConflictException);
    });

    it('a forced log-insert failure rolls back the ENTIRE transaction, including a freshly lazy-created progress row', async () => {
      const userId = await createUser();

      await expect(
        service.submitReview(userId, wordId, {
          rating: 'GOOD',
          // Deliberately invalid — bypasses the DTO's compile-time type
          // only for this one test, to force a DB-level enum rejection
          // inside the transaction after the progress row/update already
          // "succeeded" in-transaction.
          practiceMode: 'NOT_A_REAL_PRACTICE_SOURCE' as never,
          clientReviewId: randomUUID(),
        }),
      ).rejects.toThrow();

      const progress = await prisma.userWordProgress.findUnique({
        where: { userId_wordId: { userId, wordId } },
      });
      expect(progress).toBeNull(); // the whole transaction rolled back, not just the log insert
    });
  });

  describe('visibility gating (§7/§9/§17)', () => {
    it('submitReview 404s for a nonexistent word', async () => {
      const userId = await createUser();
      await expect(
        service.submitReview(userId, randomUUID(), {
          rating: 'GOOD',
          practiceMode: 'FLASHCARD',
          clientReviewId: randomUUID(),
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('a word on an unpublished deck 404s for both first-time and ongoing ratings, then resumes exactly where it left off once republished', async () => {
      const userId = await createUser();

      await prisma.vocabDeck.update({
        where: { id: hiddenDeckId },
        data: { isPublished: true },
      });
      const first = await service.submitReview(userId, hiddenWordId, {
        rating: 'GOOD',
        practiceMode: 'FLASHCARD',
        clientReviewId: randomUUID(),
      });

      await prisma.vocabDeck.update({
        where: { id: hiddenDeckId },
        data: { isPublished: false },
      });
      await expect(
        service.submitReview(userId, hiddenWordId, {
          rating: 'GOOD',
          practiceMode: 'FLASHCARD',
          clientReviewId: randomUUID(),
        }),
      ).rejects.toThrow(NotFoundException);

      // Progress itself was never touched by the rejected attempt.
      const frozen = await prisma.userWordProgress.findUnique({
        where: { userId_wordId: { userId, wordId: hiddenWordId } },
      });
      expect(frozen!.version).toBe(1);
      expect(frozen!.intervalDays).toBe(first.intervalDays);

      await prisma.vocabDeck.update({
        where: { id: hiddenDeckId },
        data: { isPublished: true },
      });
      const resumed = await service.submitReview(userId, hiddenWordId, {
        rating: 'GOOD',
        practiceMode: 'FLASHCARD',
        clientReviewId: randomUUID(),
      });
      expect(resumed.version).toBe(2); // continued from where it left off, not reset
    });

    it('the due queue excludes a currently-due word on an unpublished deck, and includes it again once republished', async () => {
      const userId = await createUser();
      await prisma.vocabDeck.update({
        where: { id: hiddenDeckId },
        data: { isPublished: true },
      });
      await service.submitReview(userId, hiddenWordId, {
        rating: 'GOOD',
        practiceMode: 'FLASHCARD',
        clientReviewId: randomUUID(),
      });
      // Force it due right now regardless of the real interval GOOD produced.
      await prisma.userWordProgress.update({
        where: { userId_wordId: { userId, wordId: hiddenWordId } },
        data: { nextReviewAt: new Date(Date.now() - 1000) },
      });

      await prisma.vocabDeck.update({
        where: { id: hiddenDeckId },
        data: { isPublished: false },
      });
      const hiddenQueue = await service.getDueReviews(userId, {});
      expect(
        hiddenQueue.data.some((item) => item.word.id === hiddenWordId),
      ).toBe(false);

      await prisma.vocabDeck.update({
        where: { id: hiddenDeckId },
        data: { isPublished: true },
      });
      const visibleQueue = await service.getDueReviews(userId, {});
      expect(
        visibleQueue.data.some((item) => item.word.id === hiddenWordId),
      ).toBe(true);
    });

    it('VocabWordService.remove() is blocked once the word has any recorded learning history', async () => {
      const userId = await createUser();
      await service.submitReview(userId, wordId, {
        rating: 'GOOD',
        practiceMode: 'FLASHCARD',
        clientReviewId: randomUUID(),
      });

      await expect(vocabWordService.remove(wordId)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('getWordProgress (§9C — outside the due queue)', () => {
    it('returns null progress + NEW previewIntervals for a never-rated word', async () => {
      const userId = await createUser();
      const result = await service.getWordProgress(userId, wordId);
      expect(result.progress).toBeNull();
      expect(result.previewIntervals).toEqual({
        again: 1,
        hard: 1,
        good: 1,
        easy: 4,
      });
    });

    it('returns real progress + a matching preview after a rating, regardless of due status', async () => {
      const userId = await createUser();
      const rated = await service.submitReview(userId, wordId, {
        rating: 'GOOD',
        practiceMode: 'FLASHCARD',
        clientReviewId: randomUUID(),
      });
      const result = await service.getWordProgress(userId, wordId);
      expect(result.progress).toMatchObject({
        state: 'REVIEW',
        intervalDays: rated.intervalDays,
      });
      // Not due for another day, yet still returned here (unlike the due queue).
      expect(result.previewIntervals.good).toBeGreaterThan(0);
    });

    it('404s for a word on an unpublished deck', async () => {
      const userId = await createUser();
      await prisma.vocabDeck.update({
        where: { id: hiddenDeckId },
        data: { isPublished: false },
      });
      await expect(
        service.getWordProgress(userId, hiddenWordId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('due queue (§8)', () => {
    it('includes previewIntervals computed by the pure scheduler for a brand-new word', async () => {
      const userId = await createUser();
      const queue = await service.getDueReviews(userId, {
        deckId,
        includeNew: true,
      });
      const item = queue.data.find((i) => i.word.id === wordId);
      expect(item?.previewIntervals).toEqual({
        again: 1,
        hard: 1,
        good: 1,
        easy: 4,
      });
    });

    it('respects the newLimit quota — zero new words when newLimit is 0, present when there is room', async () => {
      const userId = await createUser();
      const withoutRoom = await service.getDueReviews(userId, {
        deckId,
        newLimit: 0,
        includeNew: true,
      });
      expect(withoutRoom.data.some((item) => item.isNew)).toBe(false);

      const withRoom = await service.getDueReviews(userId, {
        deckId,
        newLimit: 5,
        includeNew: true,
      });
      expect(
        withRoom.data.some((item) => item.isNew && item.word.id === wordId),
      ).toBe(true);
    });

    it('bootstraps User.timezone once from a query tz, and never re-derives it from a later, different tz on the same request', async () => {
      const userId = await createUser();

      await service.getDueReviews(userId, { tz: 'Asia/Ho_Chi_Minh' });
      const afterFirst = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
      });
      expect(afterFirst.timezone).toBe('Asia/Ho_Chi_Minh');

      await service.getDueReviews(userId, { tz: 'America/New_York' });
      const afterSecond = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
      });
      expect(afterSecond.timezone).toBe('Asia/Ho_Chi_Minh'); // unchanged — no reset-by-spoofing
    });
  });

  describe('deck/library progress (§13)', () => {
    // A dedicated, isolated fixture (separate library/decks/words) rather
    // than reusing the shared deckId/wordId above — adding extra words to
    // that shared deck would change what the due-queue tests above see.
    let progressLibraryId: string;
    let progressDeckAId: string;
    let progressDeckBId: string;
    let newWordId: string;
    let learningWordId: string;
    let reviewWordId: string;
    let dueReviewWordId: string;
    let masteredWordId: string;
    let sharedAcrossDecksWordId: string; // attached to BOTH decks — must not be double-counted at library level
    // Created here (not inline inside its own test) and deleted in this
    // describe's own afterAll — Sprint 04D fixed a real leak where an
    // inline-created-and-deleted-at-the-test's-last-line deck survived (as a
    // published, real row) whenever the test's own assertions threw first.
    let emptyDeckId: string;

    beforeAll(async () => {
      const library = await prisma.vocabLibrary.create({
        data: {
          name: testFixtureName('Progress Test Library'),
          description: 'fixture',
          orderIndex: 0,
          isPublished: true,
        },
      });
      progressLibraryId = library.id;

      const deckA = await prisma.vocabDeck.create({
        data: {
          libraryId: progressLibraryId,
          name: testFixtureName('Progress Deck A'),
          orderIndex: 0,
          isPublished: true,
        },
      });
      progressDeckAId = deckA.id;
      const deckB = await prisma.vocabDeck.create({
        data: {
          libraryId: progressLibraryId,
          name: testFixtureName('Progress Deck B'),
          orderIndex: 1,
          isPublished: true,
        },
      });
      progressDeckBId = deckB.id;

      const makeWord = async (text: string) => {
        const w = await prisma.vocabWord.create({
          data: {
            text: testFixtureName(text),
            meanings: { create: [{ meaning: 'x', orderIndex: 0 }] },
          },
        });
        return w.id;
      };

      newWordId = await makeWord('new');
      learningWordId = await makeWord('learning');
      reviewWordId = await makeWord('review');
      dueReviewWordId = await makeWord('due-review');
      masteredWordId = await makeWord('mastered');
      sharedAcrossDecksWordId = await makeWord('shared');

      // Deck A gets everything; Deck B gets only the shared word (so the
      // library-level aggregate must not double-count it).
      let orderIndex = 0;
      for (const id of [
        newWordId,
        learningWordId,
        reviewWordId,
        dueReviewWordId,
        masteredWordId,
        sharedAcrossDecksWordId,
      ]) {
        await prisma.vocabDeckWord.create({
          data: {
            deckId: progressDeckAId,
            wordId: id,
            orderIndex: orderIndex++,
          },
        });
      }
      await prisma.vocabDeckWord.create({
        data: {
          deckId: progressDeckBId,
          wordId: sharedAcrossDecksWordId,
          orderIndex: 0,
        },
      });

      const emptyDeck = await prisma.vocabDeck.create({
        data: {
          libraryId: progressLibraryId,
          name: testFixtureName('Empty Deck'),
          orderIndex: 9,
          isPublished: true,
        },
      });
      emptyDeckId = emptyDeck.id;
    }, 30000);

    afterAll(async () => {
      const progressWordIds = [
        newWordId,
        learningWordId,
        reviewWordId,
        dueReviewWordId,
        masteredWordId,
        sharedAcrossDecksWordId,
      ];
      // Progress/log rows first — both word relations are Restrict (§4/§5),
      // and this inner afterAll runs before the outer/file-level afterAll
      // that deletes the users (which would otherwise cascade this away),
      // so it must not be relied on for ordering here.
      await prisma.wordReviewLog.deleteMany({
        where: { wordId: { in: progressWordIds } },
      });
      await prisma.userWordProgress.deleteMany({
        where: { wordId: { in: progressWordIds } },
      });
      await prisma.vocabDeckWord.deleteMany({
        where: { deckId: { in: [progressDeckAId, progressDeckBId] } },
      });
      await prisma.vocabWord.deleteMany({
        where: { id: { in: progressWordIds } },
      });
      await prisma.vocabDeck.deleteMany({
        where: { id: { in: [progressDeckAId, progressDeckBId, emptyDeckId] } },
      });
      await prisma.vocabLibrary.delete({ where: { id: progressLibraryId } });
    }, 30000);

    // Drives a fresh user's progress into the exact states this describe
    // block's expectations rely on. Uses real submitReview calls (not
    // fabricated rows) plus direct, documented overrides only for what a
    // rating alone can't reach quickly (MASTERED's interval/repetitions
    // floor, and forcing a REVIEW word to be due "now").
    const seedUserProgress = async (userId: string) => {
      // newWordId: left untouched — no progress row at all.
      await service.submitReview(userId, learningWordId, {
        rating: 'AGAIN',
        practiceMode: 'FLASHCARD',
        clientReviewId: randomUUID(),
      }); // -> LEARNING
      await service.submitReview(userId, reviewWordId, {
        rating: 'GOOD',
        practiceMode: 'FLASHCARD',
        clientReviewId: randomUUID(),
      }); // -> REVIEW, due tomorrow (not due today)
      await service.submitReview(userId, dueReviewWordId, {
        rating: 'GOOD',
        practiceMode: 'FLASHCARD',
        clientReviewId: randomUUID(),
      });
      await prisma.userWordProgress.update({
        where: { userId_wordId: { userId, wordId: dueReviewWordId } },
        data: { nextReviewAt: new Date(Date.now() - 1000) }, // force due now
      });
      await service.submitReview(userId, masteredWordId, {
        rating: 'GOOD',
        practiceMode: 'FLASHCARD',
        clientReviewId: randomUUID(),
      });
      await prisma.userWordProgress.update({
        where: { userId_wordId: { userId, wordId: masteredWordId } },
        data: {
          state: 'MASTERED',
          intervalDays: 30,
          repetitions: 5,
          nextReviewAt: new Date(Date.now() + 30 * 86400000),
        },
      });
      await service.submitReview(userId, sharedAcrossDecksWordId, {
        rating: 'GOOD',
        practiceMode: 'FLASHCARD',
        clientReviewId: randomUUID(),
      }); // -> REVIEW, not due
    };

    it('getDeckProgress returns real per-state counts and the floor-based startedPercent', async () => {
      const userId = await createUser();
      await seedUserProgress(userId);

      const result = await service.getDeckProgress(userId, progressDeckAId);

      expect(result).toEqual({
        deckId: progressDeckAId,
        totalWords: 6,
        newWords: 1, // newWordId only
        learningWords: 1, // learningWordId
        // reviewWordId + dueReviewWordId + sharedAcrossDecksWordId are all
        // REVIEW state — dueReviewWordId is REVIEW *and* due, not a
        // separate state.
        reviewWords: 3,
        masteredWords: 1, // masteredWordId
        dueWords: 1, // dueReviewWordId only (masteredWordId was forced not-due)
        startedPercent: Math.floor(((6 - 1) / 6) * 100),
        masteredPercent: Math.floor((1 / 6) * 100),
      });
    });

    it('getDeckProgress 404s for a currently-unpublished deck', async () => {
      const userId = await createUser();
      await prisma.vocabDeck.update({
        where: { id: progressDeckBId },
        data: { isPublished: false },
      });
      await expect(
        service.getDeckProgress(userId, progressDeckBId),
      ).rejects.toThrow(NotFoundException);
      await prisma.vocabDeck.update({
        where: { id: progressDeckBId },
        data: { isPublished: true },
      }); // restore
    });

    it('an empty deck (zero visible words) returns an honest zeroed summary, never NaN or a crash', async () => {
      const userId = await createUser();
      const result = await service.getDeckProgress(userId, emptyDeckId);
      expect(result).toEqual({
        deckId: emptyDeckId,
        totalWords: 0,
        newWords: 0,
        learningWords: 0,
        reviewWords: 0,
        masteredWords: 0,
        dueWords: 0,
        startedPercent: 0,
        masteredPercent: 0,
      });
    });

    it('getLibraryProgress aggregates across decks without double-counting a word attached to two decks, and returns a matching per-deck breakdown', async () => {
      const userId = await createUser();
      await seedUserProgress(userId);

      const result = await service.getLibraryProgress(
        userId,
        progressLibraryId,
      );

      // 6 distinct words total across both decks (sharedAcrossDecksWordId
      // counted once, not twice, even though it's attached to both decks).
      expect(result.totalWords).toBe(6);
      expect(result.newWords).toBe(1);
      expect(result.masteredWords).toBe(1);
      expect(result.dueWords).toBe(1);

      const deckA = result.decks.find((d) => d.deckId === progressDeckAId);
      const deckB = result.decks.find((d) => d.deckId === progressDeckBId);
      expect(deckA).toMatchObject({ totalWords: 6, newWords: 1 });
      // Deck B has only the one shared word, already REVIEW (rated via Deck
      // A's word) — proves progress is keyed on the word, not the deck.
      expect(deckB).toMatchObject({
        totalWords: 1,
        newWords: 0,
        reviewWords: 1,
      });
    });

    it('getLibraryProgress 404s for a currently-unpublished library', async () => {
      const userId = await createUser();
      await prisma.vocabLibrary.update({
        where: { id: progressLibraryId },
        data: { isPublished: false },
      });
      await expect(
        service.getLibraryProgress(userId, progressLibraryId),
      ).rejects.toThrow(NotFoundException);
      await prisma.vocabLibrary.update({
        where: { id: progressLibraryId },
        data: { isPublished: true },
      }); // restore
    });

    // The counting rule that makes deck totals and the library total
    // legitimately disagree. Asserted explicitly rather than assumed, so the
    // intended asymmetry can't be "fixed" into a bug later.
    it('counts a word shared across two decks in BOTH deck totals but ONCE library-wide', async () => {
      const userId = await createUser();
      const result = await service.getLibraryProgress(
        userId,
        progressLibraryId,
      );

      const deckA = result.decks.find((d) => d.deckId === progressDeckAId)!;
      const deckB = result.decks.find((d) => d.deckId === progressDeckBId)!;

      // sharedAcrossDecksWordId is attached to both decks, so it is counted
      // in each of their own totals...
      expect(deckA.totalWords).toBe(6);
      expect(deckB.totalWords).toBe(1);
      // ...but the library counts 6 DISTINCT words, not 7.
      expect(result.totalWords).toBe(6);

      const sumOfDeckTotals = result.decks.reduce(
        (sum, d) => sum + d.totalWords,
        0,
      );
      expect(sumOfDeckTotals).toBeGreaterThan(result.totalWords);
    });

    it('masteredPercent is floor-based and independent of startedPercent', async () => {
      const userId = await createUser();
      await seedUserProgress(userId);

      const result = await service.getDeckProgress(userId, progressDeckAId);

      // 1 mastered of 6 -> 16.67% -> floor 16, NOT round's 17.
      expect(result.masteredPercent).toBe(16);
      // 5 of 6 words have been touched at all -> 83%. The two percentages
      // measure different things and must not be conflated.
      expect(result.startedPercent).toBe(83);
    });

    it('a user who has rated nothing gets 0% on both percentages, not a fabricated number', async () => {
      const untouchedUser = await createUser();
      const result = await service.getDeckProgress(
        untouchedUser,
        progressDeckAId,
      );

      expect(result).toMatchObject({
        totalWords: 6,
        newWords: 6,
        learningWords: 0,
        reviewWords: 0,
        masteredWords: 0,
        dueWords: 0,
        startedPercent: 0,
        masteredPercent: 0,
      });
    });

    it('never leaks another user’s progress into this user’s counts', async () => {
      const studiedUser = await createUser();
      await seedUserProgress(studiedUser);
      const freshUser = await createUser();

      const studied = await service.getDeckProgress(
        studiedUser,
        progressDeckAId,
      );
      const fresh = await service.getDeckProgress(freshUser, progressDeckAId);

      expect(studied.newWords).toBe(1);
      expect(fresh.newWords).toBe(6); // same deck, entirely independent progress
      expect(fresh.masteredWords).toBe(0);
    });
  });

  describe('getLibrariesProgress (library grid)', () => {
    it('returns one real summary row per published library, with a real published-deck count', async () => {
      const userId = await createUser();
      const rows = await service.getLibrariesProgress(userId);

      const row = rows.find((r) => r.libraryId === libraryId);
      expect(row).toBeDefined();
      // The outer fixture library has one published deck (plus one
      // unpublished "hidden" deck, which must NOT be counted) and one
      // visible word.
      expect(row).toMatchObject({
        deckCount: 1,
        totalWords: 1,
        newWords: 1,
        startedPercent: 0,
        masteredPercent: 0,
      });
    });

    it('reflects a real rating, and keeps each library’s counts separate', async () => {
      const userId = await createUser();
      await service.submitReview(userId, wordId, {
        rating: 'GOOD',
        practiceMode: 'FLASHCARD',
        clientReviewId: randomUUID(),
      });

      const rows = await service.getLibrariesProgress(userId);
      const row = rows.find((r) => r.libraryId === libraryId);

      expect(row).toMatchObject({
        totalWords: 1,
        newWords: 0,
        reviewWords: 1,
        startedPercent: 100,
      });
      // Other libraries in the same response are unaffected by that rating.
      const others = rows.filter((r) => r.libraryId !== libraryId);
      for (const other of others) {
        expect(other.reviewWords).toBe(0);
      }
    });

    it('excludes an unpublished library entirely, then includes it again once republished', async () => {
      const userId = await createUser();

      await prisma.vocabLibrary.update({
        where: { id: libraryId },
        data: { isPublished: false },
      });
      const hidden = await service.getLibrariesProgress(userId);
      expect(hidden.find((r) => r.libraryId === libraryId)).toBeUndefined();

      await prisma.vocabLibrary.update({
        where: { id: libraryId },
        data: { isPublished: true },
      });
      const restored = await service.getLibrariesProgress(userId);
      expect(restored.find((r) => r.libraryId === libraryId)).toBeDefined();
    });
  });
});
