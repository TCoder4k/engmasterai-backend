import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WsAdapter } from '@nestjs/platform-ws';
import request from 'supertest';
import type { App } from 'supertest/types';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { expectIdempotentReplay } from './replay-assertions';
import { testFixtureName, TEST_FIXTURE_PREFIX } from './test-database.util';

// Sprint 04B e2e coverage. Requires `docker-compose up -d` (Postgres +
// Redis) from engmasterai-backend/ — mirrors auth.e2e-spec.ts's real
// full-stack convention rather than mocking the HTTP layer.
//
// Runs against the dedicated test database (test/test-database.util.ts
// refuses anything else) — see docs/memory.md's Sprint 04D entry for why
// that guard exists (published test fixtures once leaked into the real
// development database). Every fixture library/deck/word created here is
// named through `testFixtureName()` so the global sweep can still find and
// remove it even if this file's own `afterAll` never runs.
describe('Learning Engine (e2e) — Sprint 04B: due queue + rating API', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const createdUserEmails: string[] = [];
  let libraryId: string;
  let deckId: string;
  let wordId: string;
  let hiddenDeckId: string;
  let hiddenWordId: string;

  const registerAndLogin = async (): Promise<string> => {
    const email = `sprint04b-${randomUUID()}@example.test`;
    createdUserEmails.push(email);
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: 'Sprint 04B Test User', email, password: 'password123' });
    return (res.body as { accessToken: string }).accessToken;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // AppModule includes SpeakingLiveGateway — app.init() over the full module graph needs an explicit WS adapter (plain 'ws', not the socket.io default) or it throws. See learning.service.spec.ts's own comment.
    app.useWebSocketAdapter(new WsAdapter(app));
    app.useGlobalPipes(new ValidationPipe());
    await app.init();

    prisma = app.get(PrismaService);

    const library = await prisma.vocabLibrary.create({
      data: {
        name: testFixtureName('Learning E2E Library'),
        description: 'fixture',
        orderIndex: 0,
        isPublished: true,
      },
    });
    libraryId = library.id;

    const deck = await prisma.vocabDeck.create({
      data: {
        libraryId,
        name: testFixtureName('Learning E2E Deck'),
        orderIndex: 0,
        isPublished: true,
      },
    });
    deckId = deck.id;

    const word = await prisma.vocabWord.create({
      data: {
        text: testFixtureName('learning-e2e-word'),
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
        name: testFixtureName('Learning E2E Hidden Deck'),
        orderIndex: 1,
        isPublished: false,
      },
    });
    hiddenDeckId = hiddenDeck.id;
    const hiddenWord = await prisma.vocabWord.create({
      data: {
        text: testFixtureName('learning-e2e-hidden-word'),
        meanings: { create: [{ meaning: 'hidden', orderIndex: 0 }] },
      },
    });
    hiddenWordId = hiddenWord.id;
    await prisma.vocabDeckWord.create({
      data: { deckId: hiddenDeckId, wordId: hiddenWordId, orderIndex: 0 },
    });
  }, 30000);

  afterAll(async () => {
    if (createdUserEmails.length > 0) {
      await prisma.user.deleteMany({
        where: { email: { in: createdUserEmails } },
      });
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
    await app.close();
  }, 30000);

  describe('auth gating', () => {
    it('GET /learning/reviews/due 401s without a token', async () => {
      const res = await request(app.getHttpServer()).get(
        '/learning/reviews/due',
      );
      expect(res.status).toBe(401);
    });

    it('POST /learning/words/:wordId/review 401s without a token', async () => {
      const res = await request(app.getHttpServer())
        .post(`/learning/words/${wordId}/review`)
        .send({
          rating: 'GOOD',
          practiceMode: 'FLASHCARD',
          clientReviewId: randomUUID(),
        });
      expect(res.status).toBe(401);
    });
  });

  describe('validation', () => {
    it('rejects an invalid rating with 400', async () => {
      const token = await registerAndLogin();
      const res = await request(app.getHttpServer())
        .post(`/learning/words/${wordId}/review`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          rating: 'NOT_A_RATING',
          practiceMode: 'FLASHCARD',
          clientReviewId: randomUUID(),
        });
      expect(res.status).toBe(400);
    });

    it('rejects a missing clientReviewId with 400', async () => {
      const token = await registerAndLogin();
      const res = await request(app.getHttpServer())
        .post(`/learning/words/${wordId}/review`)
        .set('Authorization', `Bearer ${token}`)
        .send({ rating: 'GOOD', practiceMode: 'FLASHCARD' });
      expect(res.status).toBe(400);
    });

    it('404s for a well-formed but nonexistent word id', async () => {
      const token = await registerAndLogin();
      const res = await request(app.getHttpServer())
        .post(`/learning/words/${randomUUID()}/review`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          rating: 'GOOD',
          practiceMode: 'FLASHCARD',
          clientReviewId: randomUUID(),
        });
      expect(res.status).toBe(404);
    });
  });

  describe('rating submission', () => {
    it('a fresh rating returns the authoritative progress state, never computed client-side', async () => {
      const token = await registerAndLogin();
      const res = await request(app.getHttpServer())
        .post(`/learning/words/${wordId}/review`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          rating: 'GOOD',
          practiceMode: 'FLASHCARD',
          clientReviewId: randomUUID(),
        });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        state: 'REVIEW',
        intervalDays: 1,
        repetitions: 1,
        lapses: 0,
        version: 1,
      });
      expect(res.body.nextReviewAt).toEqual(expect.any(String));
    });

    it('retrying the same clientReviewId over HTTP returns the identical original response, not a re-derived one', async () => {
      const token = await registerAndLogin();
      const clientReviewId = randomUUID();
      const body = {
        rating: 'GOOD',
        practiceMode: 'FLASHCARD',
        clientReviewId,
      };

      const first = await request(app.getHttpServer())
        .post(`/learning/words/${wordId}/review`)
        .set('Authorization', `Bearer ${token}`)
        .send(body);
      // A second, different review for the same word, to prove the retry
      // below doesn't just happen to match because nothing else changed.
      await request(app.getHttpServer())
        .post(`/learning/words/${wordId}/review`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          rating: 'EASY',
          practiceMode: 'FLASHCARD',
          clientReviewId: randomUUID(),
        });

      const replay = await request(app.getHttpServer())
        .post(`/learning/words/${wordId}/review`)
        .set('Authorization', `Bearer ${token}`)
        .send(body);

      expect(replay.status).toBe(201);
      // Sprint 10 — the SRS snapshot replays exactly; the award does not.
      // One review is worth 1 XP, and replaying it is worth nothing.
      expectIdempotentReplay(first.body, replay.body, 1);
    });

    it('the same clientReviewId with a different rating returns 409 IDEMPOTENCY_KEY_REUSED', async () => {
      const token = await registerAndLogin();
      const clientReviewId = randomUUID();
      await request(app.getHttpServer())
        .post(`/learning/words/${wordId}/review`)
        .set('Authorization', `Bearer ${token}`)
        .send({ rating: 'GOOD', practiceMode: 'FLASHCARD', clientReviewId });

      const res = await request(app.getHttpServer())
        .post(`/learning/words/${wordId}/review`)
        .set('Authorization', `Bearer ${token}`)
        .send({ rating: 'EASY', practiceMode: 'FLASHCARD', clientReviewId });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    });

    it('two real simultaneous first-ratings for the same brand-new word both return 201, never a double error', async () => {
      const token = await registerAndLogin();
      const [r1, r2] = await Promise.all([
        request(app.getHttpServer())
          .post(`/learning/words/${wordId}/review`)
          .set('Authorization', `Bearer ${token}`)
          .send({
            rating: 'GOOD',
            practiceMode: 'FLASHCARD',
            clientReviewId: randomUUID(),
          }),
        request(app.getHttpServer())
          .post(`/learning/words/${wordId}/review`)
          .set('Authorization', `Bearer ${token}`)
          .send({
            rating: 'GOOD',
            practiceMode: 'FLASHCARD',
            clientReviewId: randomUUID(),
          }),
      ]);
      expect(r1.status).toBe(201);
      expect(r2.status).toBe(201);
      expect([r1.body.version, r2.body.version].sort()).toEqual([1, 2]);
    });
  });

  describe('word progress (outside the due queue)', () => {
    it('401s without a token', async () => {
      const res = await request(app.getHttpServer()).get(
        `/learning/words/${wordId}/progress`,
      );
      expect(res.status).toBe(401);
    });

    it('returns null progress + NEW previewIntervals for a never-rated word', async () => {
      const token = await registerAndLogin();
      const res = await request(app.getHttpServer())
        .get(`/learning/words/${wordId}/progress`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.progress).toBeNull();
      expect(res.body.previewIntervals).toEqual({
        again: 1,
        hard: 1,
        good: 1,
        easy: 4,
      });
    });
  });

  describe('due queue', () => {
    it('returns the fixture word as a NEW item with real preview intervals', async () => {
      const token = await registerAndLogin();
      const res = await request(app.getHttpServer())
        .get(`/learning/reviews/due?deckId=${deckId}&includeNew=true`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      const item = res.body.data.find(
        (i: { word: { id: string } }) => i.word.id === wordId,
      );
      expect(item).toBeDefined();
      expect(item.isNew).toBe(true);
      expect(item.previewIntervals).toEqual({
        again: 1,
        hard: 1,
        good: 1,
        easy: 4,
      });
    });

    it('excludes a word on an unpublished deck', async () => {
      const token = await registerAndLogin();
      const res = await request(app.getHttpServer())
        .get(`/learning/reviews/due?deckId=${hiddenDeckId}&includeNew=true`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(
        res.body.data.some(
          (i: { word: { id: string } }) => i.word.id === hiddenWordId,
        ),
      ).toBe(false);
    });

    it('rejects an out-of-range limit with 400', async () => {
      const token = await registerAndLogin();
      const res = await request(app.getHttpServer())
        .get('/learning/reviews/due?limit=99999')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(400);
    });
  });

  describe('deck/library progress (Sprint 04D)', () => {
    it('GET /learning/decks/:deckId/progress 401s without a token', async () => {
      const res = await request(app.getHttpServer()).get(
        `/learning/decks/${deckId}/progress`,
      );
      expect(res.status).toBe(401);
    });

    it('returns a real, honest summary for a deck with one unrated word', async () => {
      const token = await registerAndLogin();
      const res = await request(app.getHttpServer())
        .get(`/learning/decks/${deckId}/progress`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        deckId,
        totalWords: 1,
        newWords: 1,
        learningWords: 0,
        reviewWords: 0,
        masteredWords: 0,
        dueWords: 0,
        startedPercent: 0,
        masteredPercent: 0,
      });
    });

    it('reflects a real rating in both deck and library progress, without N+1 per-deck calls', async () => {
      const token = await registerAndLogin();
      await request(app.getHttpServer())
        .post(`/learning/words/${wordId}/review`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          rating: 'GOOD',
          practiceMode: 'FLASHCARD',
          clientReviewId: randomUUID(),
        });

      const deckRes = await request(app.getHttpServer())
        .get(`/learning/decks/${deckId}/progress`)
        .set('Authorization', `Bearer ${token}`);
      expect(deckRes.body).toMatchObject({
        totalWords: 1,
        newWords: 0,
        reviewWords: 1,
        startedPercent: 100,
      });

      const libraryRes = await request(app.getHttpServer())
        .get(`/learning/libraries/${libraryId}/progress`)
        .set('Authorization', `Bearer ${token}`);
      expect(libraryRes.status).toBe(200);
      const deckEntry = libraryRes.body.decks.find(
        (d: { deckId: string }) => d.deckId === deckId,
      );
      expect(deckEntry).toMatchObject({
        totalWords: 1,
        newWords: 0,
        reviewWords: 1,
      });
    });

    it('404s for a deck that is itself unpublished', async () => {
      const token = await registerAndLogin();
      const res = await request(app.getHttpServer())
        .get(`/learning/decks/${hiddenDeckId}/progress`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
    });

    it('GET /learning/libraries/progress returns a real summary row per published library', async () => {
      const token = await registerAndLogin();
      const res = await request(app.getHttpServer())
        .get('/learning/libraries/progress')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      const row = res.body.data.find(
        (r: { libraryId: string }) => r.libraryId === libraryId,
      );
      expect(row).toMatchObject({
        deckCount: 1, // the hidden deck is excluded
        totalWords: 1,
        newWords: 1,
        startedPercent: 0,
        masteredPercent: 0,
      });
    });

    it('GET /learning/libraries/progress 401s without a token', async () => {
      const res = await request(app.getHttpServer()).get(
        '/learning/libraries/progress',
      );
      expect(res.status).toBe(401);
    });
  });

  // The regression guard for the incident this sprint fixed. Test fixtures
  // once leaked into the development database and appeared in the real
  // student library list; nothing asserted that student-facing endpoints
  // stayed clean, so the leak went unnoticed across five runs.
  //
  // This suite has, by this point, created published fixture libraries and
  // decks — so if the isolation ever regresses (a suite pointed at the dev
  // database, or fixtures created outside the `__test__` namespace), this
  // check is what surfaces it.
  describe('fixture containment (Sprint 04D regression guard)', () => {
    it('every fixture this suite created is inside the sweepable test namespace', async () => {
      const [library, deck, hiddenDeck, word] = await Promise.all([
        prisma.vocabLibrary.findUniqueOrThrow({ where: { id: libraryId } }),
        prisma.vocabDeck.findUniqueOrThrow({ where: { id: deckId } }),
        prisma.vocabDeck.findUniqueOrThrow({ where: { id: hiddenDeckId } }),
        prisma.vocabWord.findUniqueOrThrow({ where: { id: wordId } }),
      ]);

      // Without the prefix, the global teardown sweep cannot find these rows
      // if this file's own afterAll never runs (an interrupted or killed
      // jest process) — which is exactly how the original leak happened.
      expect(library.name.startsWith(TEST_FIXTURE_PREFIX)).toBe(true);
      expect(deck.name.startsWith(TEST_FIXTURE_PREFIX)).toBe(true);
      expect(hiddenDeck.name.startsWith(TEST_FIXTURE_PREFIX)).toBe(true);
      expect(word.text.startsWith(TEST_FIXTURE_PREFIX)).toBe(true);
    });

    it('the student library list contains no test-namespace content beyond this suite’s own fixtures', async () => {
      const res = await request(app.getHttpServer()).get(
        '/vocab/libraries?limit=100',
      );
      expect(res.status).toBe(200);

      // Anything prefixed that is NOT one of this suite's live fixtures is
      // orphaned residue from an earlier run that failed to clean up.
      const strays = (res.body.data as { id: string; name: string }[]).filter(
        (l) => l.name.startsWith(TEST_FIXTURE_PREFIX) && l.id !== libraryId,
      );
      expect(strays).toEqual([]);
    });
  });
});
