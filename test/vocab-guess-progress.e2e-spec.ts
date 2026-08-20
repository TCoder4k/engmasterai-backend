import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WsAdapter } from '@nestjs/platform-ws';
import request from 'supertest';
import type { App } from 'supertest/types';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { testFixtureName, TEST_FIXTURE_PREFIX } from './test-database.util';

// Persistent, per-deck "Guess the Word" progress. Deliberately NOT part of
// the SRS engine (see VocabGuessProgress in schema.prisma and
// learning.e2e-spec.ts for the real spaced-repetition suite) — no
// easeFactor/interval/due-date, no idempotency-key machinery, and scoped
// per (user, deck, word) rather than globally per (user, word).
//
// Runs against the dedicated test database (test/test-database.util.ts
// refuses anything else). Every fixture is named through testFixtureName()
// so the global sweep can find and remove it even if this file's own
// afterAll never runs.
describe('Vocabulary Guess-the-Word progress (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const createdUserEmails: string[] = [];
  let libraryId: string;
  let deckAId: string;
  let deckBId: string;
  let hiddenDeckId: string;
  let sharedWordId: string; // attached to BOTH deckA and deckB
  let deckOnlyWordId: string; // attached to deckA only
  let unattachedWordId: string; // exists, but attached to neither deck
  let hiddenWordId: string;

  const registerAndLogin = async (): Promise<string> => {
    const email = `guess-progress-${randomUUID()}@example.test`;
    createdUserEmails.push(email);
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: 'Guess Progress Test User', email, password: 'password123' });
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
        name: testFixtureName('Guess Progress E2E Library'),
        description: 'fixture',
        orderIndex: 0,
        isPublished: true,
      },
    });
    libraryId = library.id;

    const deckA = await prisma.vocabDeck.create({
      data: {
        libraryId,
        name: testFixtureName('Guess Progress E2E Deck A'),
        orderIndex: 0,
        isPublished: true,
      },
    });
    deckAId = deckA.id;

    const deckB = await prisma.vocabDeck.create({
      data: {
        libraryId,
        name: testFixtureName('Guess Progress E2E Deck B'),
        orderIndex: 1,
        isPublished: true,
      },
    });
    deckBId = deckB.id;

    const hiddenDeck = await prisma.vocabDeck.create({
      data: {
        libraryId,
        name: testFixtureName('Guess Progress E2E Hidden Deck'),
        orderIndex: 2,
        isPublished: false,
      },
    });
    hiddenDeckId = hiddenDeck.id;

    const sharedWord = await prisma.vocabWord.create({
      data: {
        text: testFixtureName('guess-progress-shared-word'),
        meanings: { create: [{ meaning: 'a shared fixture word', orderIndex: 0 }] },
      },
    });
    sharedWordId = sharedWord.id;

    const deckOnlyWord = await prisma.vocabWord.create({
      data: {
        text: testFixtureName('guess-progress-deckA-only-word'),
        meanings: { create: [{ meaning: 'deck A only', orderIndex: 0 }] },
      },
    });
    deckOnlyWordId = deckOnlyWord.id;

    const unattachedWord = await prisma.vocabWord.create({
      data: {
        text: testFixtureName('guess-progress-unattached-word'),
        meanings: { create: [{ meaning: 'not attached to any fixture deck', orderIndex: 0 }] },
      },
    });
    unattachedWordId = unattachedWord.id;

    const hiddenWord = await prisma.vocabWord.create({
      data: {
        text: testFixtureName('guess-progress-hidden-word'),
        meanings: { create: [{ meaning: 'hidden', orderIndex: 0 }] },
      },
    });
    hiddenWordId = hiddenWord.id;

    await prisma.vocabDeckWord.createMany({
      data: [
        { deckId: deckAId, wordId: sharedWordId, orderIndex: 0 },
        { deckId: deckAId, wordId: deckOnlyWordId, orderIndex: 1 },
        { deckId: deckBId, wordId: sharedWordId, orderIndex: 0 },
        { deckId: hiddenDeckId, wordId: hiddenWordId, orderIndex: 0 },
      ],
    });
  }, 30000);

  afterAll(async () => {
    if (createdUserEmails.length > 0) {
      await prisma.user.deleteMany({
        where: { email: { in: createdUserEmails } },
      });
    }
    await prisma.vocabDeckWord.deleteMany({
      where: { deckId: { in: [deckAId, deckBId, hiddenDeckId] } },
    });
    await prisma.vocabWord.deleteMany({
      where: {
        id: { in: [sharedWordId, deckOnlyWordId, unattachedWordId, hiddenWordId] },
      },
    });
    await prisma.vocabDeck.deleteMany({
      where: { id: { in: [deckAId, deckBId, hiddenDeckId] } },
    });
    await prisma.vocabLibrary.delete({ where: { id: libraryId } });
    await app.close();
  }, 30000);

  describe('auth gating', () => {
    it('GET .../guess-progress 401s without a token', async () => {
      const res = await request(app.getHttpServer()).get(
        `/vocab/decks/${deckAId}/guess-progress`,
      );
      expect(res.status).toBe(401);
    });

    it('POST .../guess-progress/words/:wordId 401s without a token', async () => {
      const res = await request(app.getHttpServer()).post(
        `/vocab/decks/${deckAId}/guess-progress/words/${sharedWordId}`,
      );
      expect(res.status).toBe(401);
    });

    it('DELETE .../guess-progress 401s without a token', async () => {
      const res = await request(app.getHttpServer()).delete(
        `/vocab/decks/${deckAId}/guess-progress`,
      );
      expect(res.status).toBe(401);
    });
  });

  describe('reading progress', () => {
    it('starts with the real total word count and zero learned words', async () => {
      const token = await registerAndLogin();
      const res = await request(app.getHttpServer())
        .get(`/vocab/decks/${deckAId}/guess-progress`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        deckId: deckAId,
        totalWords: 2,
        learnedWordIds: [],
      });
    });

    it('404s for an unpublished (hidden) deck, same as the words endpoint', async () => {
      const token = await registerAndLogin();
      const res = await request(app.getHttpServer())
        .get(`/vocab/decks/${hiddenDeckId}/guess-progress`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
    });

    it('404s for a well-formed but nonexistent deck id', async () => {
      const token = await registerAndLogin();
      const res = await request(app.getHttpServer())
        .get(`/vocab/decks/${randomUUID()}/guess-progress`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
    });
  });

  describe('marking a word learned', () => {
    it('a correct answer marks the word learned, and GET reflects it', async () => {
      const token = await registerAndLogin();

      const markRes = await request(app.getHttpServer())
        .post(`/vocab/decks/${deckAId}/guess-progress/words/${deckOnlyWordId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(markRes.status).toBe(201);
      expect(markRes.body.wordId).toBe(deckOnlyWordId);
      expect(markRes.body.learnedAt).toEqual(expect.any(String));

      const progressRes = await request(app.getHttpServer())
        .get(`/vocab/decks/${deckAId}/guess-progress`)
        .set('Authorization', `Bearer ${token}`);
      expect(progressRes.body.learnedWordIds).toEqual([deckOnlyWordId]);
    });

    it('marking an already-learned word again is a harmless no-op — learnedAt does not move', async () => {
      const token = await registerAndLogin();
      const first = await request(app.getHttpServer())
        .post(`/vocab/decks/${deckAId}/guess-progress/words/${deckOnlyWordId}`)
        .set('Authorization', `Bearer ${token}`);

      const second = await request(app.getHttpServer())
        .post(`/vocab/decks/${deckAId}/guess-progress/words/${deckOnlyWordId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(second.status).toBe(201);
      expect(second.body.learnedAt).toBe(first.body.learnedAt);
    });

    it('404s when the word is not attached to the deck', async () => {
      const token = await registerAndLogin();
      const res = await request(app.getHttpServer())
        .post(`/vocab/decks/${deckAId}/guess-progress/words/${unattachedWordId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
    });

    it('404s for an unpublished (hidden) deck', async () => {
      const token = await registerAndLogin();
      const res = await request(app.getHttpServer())
        .post(`/vocab/decks/${hiddenDeckId}/guess-progress/words/${hiddenWordId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
    });
  });

  describe('per-deck scoping — the same word tracks independently in two decks', () => {
    it('learning the shared word in deck A does not mark it learned in deck B', async () => {
      const token = await registerAndLogin();

      await request(app.getHttpServer())
        .post(`/vocab/decks/${deckAId}/guess-progress/words/${sharedWordId}`)
        .set('Authorization', `Bearer ${token}`);

      const deckAProgress = await request(app.getHttpServer())
        .get(`/vocab/decks/${deckAId}/guess-progress`)
        .set('Authorization', `Bearer ${token}`);
      expect(deckAProgress.body.learnedWordIds).toContain(sharedWordId);

      const deckBProgress = await request(app.getHttpServer())
        .get(`/vocab/decks/${deckBId}/guess-progress`)
        .set('Authorization', `Bearer ${token}`);
      expect(deckBProgress.body.learnedWordIds).not.toContain(sharedWordId);
    });
  });

  describe('resetting a deck', () => {
    it('DELETE clears every learned word for that deck, and a reload shows 0 again', async () => {
      const token = await registerAndLogin();

      await request(app.getHttpServer())
        .post(`/vocab/decks/${deckAId}/guess-progress/words/${sharedWordId}`)
        .set('Authorization', `Bearer ${token}`);
      await request(app.getHttpServer())
        .post(`/vocab/decks/${deckAId}/guess-progress/words/${deckOnlyWordId}`)
        .set('Authorization', `Bearer ${token}`);

      const before = await request(app.getHttpServer())
        .get(`/vocab/decks/${deckAId}/guess-progress`)
        .set('Authorization', `Bearer ${token}`);
      expect(before.body.learnedWordIds).toHaveLength(2);

      const resetRes = await request(app.getHttpServer())
        .delete(`/vocab/decks/${deckAId}/guess-progress`)
        .set('Authorization', `Bearer ${token}`);
      expect(resetRes.status).toBe(204);

      const after = await request(app.getHttpServer())
        .get(`/vocab/decks/${deckAId}/guess-progress`)
        .set('Authorization', `Bearer ${token}`);
      expect(after.body.learnedWordIds).toEqual([]);
    });

    it('resetting deck A does not touch the same word\'s learned state in deck B', async () => {
      const token = await registerAndLogin();

      await request(app.getHttpServer())
        .post(`/vocab/decks/${deckAId}/guess-progress/words/${sharedWordId}`)
        .set('Authorization', `Bearer ${token}`);
      await request(app.getHttpServer())
        .post(`/vocab/decks/${deckBId}/guess-progress/words/${sharedWordId}`)
        .set('Authorization', `Bearer ${token}`);

      await request(app.getHttpServer())
        .delete(`/vocab/decks/${deckAId}/guess-progress`)
        .set('Authorization', `Bearer ${token}`);

      const deckBProgress = await request(app.getHttpServer())
        .get(`/vocab/decks/${deckBId}/guess-progress`)
        .set('Authorization', `Bearer ${token}`);
      expect(deckBProgress.body.learnedWordIds).toContain(sharedWordId);
    });
  });

  // The regression guard for the incident Sprint 04D fixed (see
  // learning.e2e-spec.ts's identical block) — every fixture this suite
  // creates must be inside the sweepable namespace, so an interrupted run
  // can never leave published content visible to real students.
  describe('fixture containment', () => {
    it('every fixture this suite created is inside the sweepable test namespace', async () => {
      const [library, deckA, deckB, hiddenDeck] = await Promise.all([
        prisma.vocabLibrary.findUniqueOrThrow({ where: { id: libraryId } }),
        prisma.vocabDeck.findUniqueOrThrow({ where: { id: deckAId } }),
        prisma.vocabDeck.findUniqueOrThrow({ where: { id: deckBId } }),
        prisma.vocabDeck.findUniqueOrThrow({ where: { id: hiddenDeckId } }),
      ]);

      expect(library.name.startsWith(TEST_FIXTURE_PREFIX)).toBe(true);
      expect(deckA.name.startsWith(TEST_FIXTURE_PREFIX)).toBe(true);
      expect(deckB.name.startsWith(TEST_FIXTURE_PREFIX)).toBe(true);
      expect(hiddenDeck.name.startsWith(TEST_FIXTURE_PREFIX)).toBe(true);
    });
  });
});
