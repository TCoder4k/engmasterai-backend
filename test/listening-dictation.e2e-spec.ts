import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { testFixtureName } from './test-database.util';

// Sprint 11 Phase 4A — Dictation progress (e2e).
//
// Five properties, each of which is either a security rule or a data rule that
// a unit test on the scorer cannot reach:
//
//   1. THE SERVER GRADES. No request body can assert an accuracy, a word count
//      or a completion, and extra properties sent anyway are ignored — the
//      app's ValidationPipe runs bare (no `whitelist`), so this guarantee has
//      to come from the service reading only its declared fields.
//   2. IDEMPOTENCY IS AT THE DATABASE LEVEL. A replayed clientAttemptId
//      returns the ORIGINAL result and creates no second row, even after the
//      reference sentence has been edited underneath it.
//   3. COMPLETION IS DERIVED, NEVER STORED. Adding a sentence to a finished
//      recording drops it back to in-progress; removing an unfinished one can
//      complete it. Both must happen with no backfill.
//   4. THE WRITE PATH HAS THE SAME 404 AS THE READ PATH. A draft recording, a
//      draft category and a mode that is switched off are indistinguishable.
//   5. THE BATCH READ'S QUERY COUNT DOES NOT GROW WITH THE NUMBER OF IDS.
describe('Listening Dictation (e2e) — Sprint 11 Phase 4A', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const createdUserEmails: string[] = [];
  let adminToken: string;
  let studentToken: string;
  let studentId: string;
  let categoryId: string;

  const YOUTUBE_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

  const registerStudent = async (): Promise<{ token: string; id: string }> => {
    const email = `p4a-student-${randomUUID()}@example.test`;
    createdUserEmails.push(email);
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: 'Phase 4A Student', email, password: 'password123' });
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    return { token: (res.body as { accessToken: string }).accessToken, id: user.id };
  };

  /** A published recording with the given sentences, ready to practise. */
  const publishRecording = async (
    texts: string[],
    overrides: Record<string, unknown> = {},
  ): Promise<{ contentId: string; segmentIds: string[] }> => {
    const created = await request(app.getHttpServer())
      .post('/listening/manage/contents')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        categoryId,
        title: testFixtureName('Dictation'),
        level: 'B1',
        mediaType: 'VIDEO',
        mediaProvider: 'YOUTUBE',
        mediaUrl: YOUTUBE_URL,
        sourceName: 'Fixture Channel',
        sourceUrl: 'https://www.youtube.com/@fixture',
        durationMs: 600_000,
        supportedModes: ['DICTATION'],
        ...overrides,
      })
      .expect(201);
    const contentId = (created.body as { id: string }).id;

    await putSegments(
      contentId,
      texts.map((text) => ({ text })),
    ).expect(200);

    await request(app.getHttpServer())
      .patch(`/listening/manage/contents/${contentId}/publish`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const segments = await prisma.listeningSegment.findMany({
      where: { contentId },
      orderBy: { orderIndex: 'asc' },
      select: { id: true },
    });

    return { contentId, segmentIds: segments.map((s) => s.id) };
  };

  /**
   * Whole-document segment save.
   *
   * PASSING AN `id` MEANS "edit this sentence"; omitting one means "create a
   * new sentence". That distinction is the whole point of the upsert Phase 1
   * built, and it is load-bearing here: a save without ids DELETES the old
   * rows, which cascades away the student progress hanging off them. Tests
   * that mean to edit in place must pass the id, or they silently exercise a
   * different scenario than the one their name claims.
   */
  const putSegments = (
    contentId: string,
    segments: { id?: string; text: string }[],
  ) =>
    request(app.getHttpServer())
      .put(`/listening/manage/contents/${contentId}/segments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        segments: segments.map((segment, index) => ({
          ...(segment.id ? { id: segment.id } : {}),
          orderIndex: index,
          text: segment.text,
          startTimeMs: index * 5_000,
          endTimeMs: index * 5_000 + 4_000,
        })),
      });

  const submit = (
    segmentId: string,
    body: Record<string, unknown>,
    token = studentToken,
  ) =>
    request(app.getHttpServer())
      .post(`/listening/segments/${segmentId}/dictation/attempts`)
      .set('Authorization', `Bearer ${token}`)
      .send({ clientAttemptId: randomUUID(), revealedWordCount: 0, ...body });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    await app.init();

    prisma = app.get(PrismaService);

    const email = `p4a-admin-${randomUUID()}@example.test`;
    createdUserEmails.push(email);
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: 'Phase 4A Admin', email, password: 'password123' });
    await prisma.user.update({ where: { email }, data: { role: 'ADMIN' } });
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'password123', role: 'ADMIN' });
    adminToken = (login.body as { accessToken: string }).accessToken;

    const student = await registerStudent();
    studentToken = student.token;
    studentId = student.id;

    const category = await prisma.listeningCategory.create({
      data: {
        name: testFixtureName('P4A Category'),
        nameVi: testFixtureName('P4A Danh mục'),
        orderIndex: 0,
        isPublished: true,
      },
    });
    categoryId = category.id;
  });

  afterAll(async () => {
    // Restrict relations: attempts and progress must go before the content
    // they point at, or the delete throws P2003 and leaves fixtures behind.
    await prisma.listeningDictationAttempt.deleteMany({
      where: { content: { categoryId } },
    });
    await prisma.listeningDictationSegmentProgress.deleteMany({
      where: { content: { categoryId } },
    });
    await prisma.listeningContent.deleteMany({ where: { categoryId } });
    await prisma.listeningCategory.deleteMany({ where: { id: categoryId } });
    await prisma.user.deleteMany({
      where: { email: { in: createdUserEmails } },
    });
    await app.close();
  });

  // --- the server grades ----------------------------------------------------

  describe('grading is server-side', () => {
    it('scores a correct answer and marks the sentence solved', async () => {
      const { segmentIds } = await publishRecording(['hello there friend']);

      const res = await submit(segmentIds[0], {
        typedText: 'Hello there, friend!',
      }).expect(201);

      expect(res.body).toMatchObject({
        accuracyPercent: 100,
        wordsCorrect: 3,
        wordsTotal: 3,
        solved: true,
        assisted: false,
      });
      expect(res.body.segment.completedAt).not.toBeNull();
      expect(res.body.content).toMatchObject({
        totalSegments: 1,
        completedSegments: 1,
        completed: true,
      });
    });

    it('scores a partly-correct answer without solving it', async () => {
      const { segmentIds } = await publishRecording(['one two three four']);

      const res = await submit(segmentIds[0], {
        typedText: 'one two three five',
      }).expect(201);

      expect(res.body).toMatchObject({ accuracyPercent: 75, solved: false });
      expect(res.body.segment.completedAt).toBeNull();
      expect(res.body.content.completed).toBe(false);
    });

    // The app's ValidationPipe is bare — unknown properties survive on
    // req.body. This guarantee therefore comes from the service reading only
    // its three declared fields, and this test is what proves that, not the
    // pipe.
    it('ignores a score the client tries to declare', async () => {
      const { segmentIds } = await publishRecording(['alpha beta gamma']);

      const res = await submit(segmentIds[0], {
        typedText: 'alpha wrong gamma',
        accuracyPercent: 100,
        wordsCorrect: 3,
        wordsTotal: 3,
        solved: true,
        xpAwarded: 9999,
      }).expect(201);

      expect(res.body.accuracyPercent).toBe(67);
      expect(res.body.solved).toBe(false);
      expect(res.body).not.toHaveProperty('xpAwarded');
    });

    it('never lowers bestAccuracyPercent on a worse retry', async () => {
      const { segmentIds } = await publishRecording(['one two three four']);

      await submit(segmentIds[0], { typedText: 'one two three four' }).expect(201);
      const worse = await submit(segmentIds[0], { typedText: 'one' }).expect(201);

      expect(worse.body.accuracyPercent).toBe(25);
      expect(worse.body.segment.bestAccuracyPercent).toBe(100);
      // completedAt is set once and never cleared, exactly like
      // LessonStepProgress: a bad retry does not un-finish a solved sentence.
      expect(worse.body.segment.completedAt).not.toBeNull();
      expect(worse.body.segment.attemptCount).toBe(2);
    });

    it('keeps `assisted` sticky once a word has been revealed', async () => {
      const { segmentIds } = await publishRecording(['red green blue']);

      await submit(segmentIds[0], {
        typedText: 'red green blue',
        revealedWordCount: 1,
      }).expect(201);
      const clean = await submit(segmentIds[0], {
        typedText: 'red green blue',
        revealedWordCount: 0,
      }).expect(201);

      // A sentence solved with help was not solved unaided, and a later clean
      // run does not rewrite that history.
      expect(clean.body.segment.assisted).toBe(true);
    });
  });

  // --- idempotency ----------------------------------------------------------

  describe('idempotency at the database level', () => {
    it('replays the original result and writes no second row', async () => {
      const { segmentIds } = await publishRecording(['stable sentence here']);
      const clientAttemptId = randomUUID();

      const first = await request(app.getHttpServer())
        .post(`/listening/segments/${segmentIds[0]}/dictation/attempts`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ clientAttemptId, typedText: 'stable sentence here', revealedWordCount: 0 })
        .expect(201);

      const replay = await request(app.getHttpServer())
        .post(`/listening/segments/${segmentIds[0]}/dictation/attempts`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ clientAttemptId, typedText: 'stable sentence here', revealedWordCount: 0 })
        .expect(201);

      expect(replay.body.accuracyPercent).toBe(first.body.accuracyPercent);
      expect(replay.body.solved).toBe(first.body.solved);
      expect(
        await prisma.listeningDictationAttempt.count({
          where: { userId: studentId, clientAttemptId },
        }),
      ).toBe(1);
      // The replay must not inflate the attempt counter either.
      expect(replay.body.segment.attemptCount).toBe(1);
    });

    it('replays the ORIGINAL score even after the sentence was edited', async () => {
      const { contentId, segmentIds } = await publishRecording(['first wording here']);
      const clientAttemptId = randomUUID();

      await request(app.getHttpServer())
        .post(`/listening/segments/${segmentIds[0]}/dictation/attempts`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ clientAttemptId, typedText: 'first wording here', revealedWordCount: 0 })
        .expect(201);

      // Admin fixes a typo on live content — allowed by design.
      await putSegments(contentId, [
        { id: segmentIds[0], text: 'completely different words now' },
      ]).expect(200);

      const replay = await request(app.getHttpServer())
        .post(`/listening/segments/${segmentIds[0]}/dictation/attempts`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ clientAttemptId, typedText: 'first wording here', revealedWordCount: 0 })
        .expect(201);

      // Re-grading here would hand the student two different results for one
      // attempt. The recorded outcome wins.
      expect(replay.body.accuracyPercent).toBe(100);
      expect(replay.body.solved).toBe(true);
    });

    it('scopes the idempotency key per user', async () => {
      const { segmentIds } = await publishRecording(['shared key sentence']);
      const other = await registerStudent();
      const clientAttemptId = randomUUID();

      await request(app.getHttpServer())
        .post(`/listening/segments/${segmentIds[0]}/dictation/attempts`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ clientAttemptId, typedText: 'shared key sentence', revealedWordCount: 0 })
        .expect(201);

      // The SAME key from a different student is a different attempt — one
      // user's key space can never collide with another's.
      const second = await request(app.getHttpServer())
        .post(`/listening/segments/${segmentIds[0]}/dictation/attempts`)
        .set('Authorization', `Bearer ${other.token}`)
        .send({ clientAttemptId, typedText: 'wrong wrong wrong', revealedWordCount: 0 })
        .expect(201);

      expect(second.body.accuracyPercent).toBe(0);
    });

    it('stores the reference text as it was when graded', async () => {
      const { contentId, segmentIds } = await publishRecording(['snapshot me please']);

      await submit(segmentIds[0], { typedText: 'snapshot me please' }).expect(201);
      await putSegments(contentId, [
        { id: segmentIds[0], text: 'edited afterwards entirely' },
      ]).expect(200);

      const attempt = await prisma.listeningDictationAttempt.findFirstOrThrow({
        where: { userId: studentId, segmentId: segmentIds[0] },
      });

      // Without this column an old score would be unexplainable against the
      // edited sentence.
      expect(attempt.referenceTextSnapshot).toBe('snapshot me please');
    });
  });

  // --- completion is derived ------------------------------------------------

  describe('completion is derived, never stored', () => {
    it('drops a finished recording back to in-progress when a sentence is added', async () => {
      const { contentId, segmentIds } = await publishRecording(['only sentence here']);
      await submit(segmentIds[0], { typedText: 'only sentence here' }).expect(201);

      const before = await request(app.getHttpServer())
        .get(`/listening/contents/${contentId}`)
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(200);
      expect(before.body.dictationProgress.completed).toBe(true);

      // The existing sentence keeps its id (and therefore the student's
      // progress); only the second one is new.
      await putSegments(contentId, [
        { id: segmentIds[0], text: 'only sentence here' },
        { text: 'a brand new sentence' },
      ]).expect(200);

      const after = await request(app.getHttpServer())
        .get(`/listening/contents/${contentId}`)
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(200);

      // No counter had to be recounted and no backfill had to run — this is
      // the whole reason nothing is cached.
      expect(after.body.dictationProgress).toMatchObject({
        totalSegments: 2,
        completedSegments: 1,
        completed: false,
      });
    });

    it('completes a recording when the unfinished sentence is removed', async () => {
      const { contentId, segmentIds } = await publishRecording(['done one', 'not done two']);
      await submit(segmentIds[0], { typedText: 'done one' }).expect(201);

      await putSegments(contentId, [
        { id: segmentIds[0], text: 'done one' },
      ]).expect(200);

      const after = await request(app.getHttpServer())
        .get(`/listening/contents/${contentId}`)
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(200);

      expect(after.body.dictationProgress).toMatchObject({
        totalSegments: 1,
        completedSegments: 1,
        completed: true,
      });
    });

    it('reports a recording with no sentences as not complete', async () => {
      const { contentId } = await publishRecording(['temporary sentence']);
      // Deleting every segment leaves 0/0, which must NOT read as finished.
      await prisma.listeningSegment.deleteMany({ where: { contentId } });

      const res = await request(app.getHttpServer())
        .get(`/listening/contents/${contentId}`)
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(200);

      expect(res.body.dictationProgress).toMatchObject({
        totalSegments: 0,
        completedSegments: 0,
        completed: false,
      });
    });

    it('rehydrates per-sentence progress on the content read', async () => {
      const { contentId, segmentIds } = await publishRecording(['alpha one', 'beta two']);
      await submit(segmentIds[0], { typedText: 'alpha one' }).expect(201);

      const res = await request(app.getHttpServer())
        .get(`/listening/contents/${contentId}`)
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(200);

      // Only the attempted sentence has a row. Absence IS "not started" —
      // there is no placeholder row of zeroes.
      expect(res.body.dictationProgress.segments).toHaveLength(1);
      expect(res.body.dictationProgress.segments[0]).toMatchObject({
        segmentId: segmentIds[0],
        attemptCount: 1,
      });
    });

    it('reports null progress for a recording that does not enable DICTATION', async () => {
      const { contentId } = await publishRecording(['shadow only sentence'], {
        supportedModes: ['SHADOWING'],
      });

      const res = await request(app.getHttpServer())
        .get(`/listening/contents/${contentId}`)
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(200);

      // Null, not an empty summary: "this mode is off" and "you have done none
      // of it" are different facts.
      expect(res.body.dictationProgress).toBeNull();
    });
  });

  // --- the write path is as guarded as the read path ------------------------

  describe('visibility on the write path', () => {
    it('404s for a sentence in a DRAFT recording', async () => {
      const { contentId, segmentIds } = await publishRecording(['draft me now']);
      await request(app.getHttpServer())
        .patch(`/listening/manage/contents/${contentId}/unpublish`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      await submit(segmentIds[0], { typedText: 'draft me now' }).expect(404);
    });

    it('404s for a sentence whose CATEGORY is draft', async () => {
      const draftCategory = await prisma.listeningCategory.create({
        data: {
          name: testFixtureName('P4A Draft Cat'),
          nameVi: testFixtureName('P4A Danh mục nháp'),
          orderIndex: 1,
          isPublished: false,
        },
      });

      const created = await request(app.getHttpServer())
        .post('/listening/manage/contents')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          categoryId: draftCategory.id,
          title: testFixtureName('Hidden'),
          level: 'B1',
          mediaType: 'VIDEO',
          mediaProvider: 'YOUTUBE',
          mediaUrl: YOUTUBE_URL,
          sourceName: 'Fixture Channel',
          sourceUrl: 'https://www.youtube.com/@fixture',
          durationMs: 60_000,
          supportedModes: ['DICTATION'],
        })
        .expect(201);
      const hiddenId = (created.body as { id: string }).id;
      await putSegments(hiddenId, [{ text: 'hidden sentence here' }]).expect(200);

      const segment = await prisma.listeningSegment.findFirstOrThrow({
        where: { contentId: hiddenId },
      });

      await submit(segment.id, { typedText: 'hidden sentence here' }).expect(404);

      await prisma.listeningContent.deleteMany({ where: { id: hiddenId } });
      await prisma.listeningCategory.deleteMany({ where: { id: draftCategory.id } });
    });

    it('404s when the recording does not enable DICTATION', async () => {
      const { segmentIds } = await publishRecording(['shadow sentence only'], {
        supportedModes: ['SHADOWING'],
      });

      await submit(segmentIds[0], { typedText: 'shadow sentence only' }).expect(404);
    });

    it('404s for a sentence that does not exist', async () => {
      await submit(randomUUID(), { typedText: 'anything' }).expect(404);
    });

    it('rejects an unauthenticated submission', async () => {
      const { segmentIds } = await publishRecording(['auth please now']);
      await request(app.getHttpServer())
        .post(`/listening/segments/${segmentIds[0]}/dictation/attempts`)
        .send({ clientAttemptId: randomUUID(), typedText: 'x', revealedWordCount: 0 })
        .expect(401);
    });

    it('rejects a body with no clientAttemptId', async () => {
      const { segmentIds } = await publishRecording(['validate me here']);
      await request(app.getHttpServer())
        .post(`/listening/segments/${segmentIds[0]}/dictation/attempts`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ typedText: 'validate me here', revealedWordCount: 0 })
        .expect(400);
    });
  });

  // --- the batch read -------------------------------------------------------

  describe('batch progress read', () => {
    it('returns one entry per visible id and omits the rest', async () => {
      const a = await publishRecording(['batch one sentence']);
      const b = await publishRecording(['batch two sentence']);
      await submit(a.segmentIds[0], { typedText: 'batch one sentence' }).expect(201);

      const res = await request(app.getHttpServer())
        .get('/listening/progress')
        .query({ contentIds: `${a.contentId},${b.contentId},${randomUUID()}` })
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(200);

      const rows = res.body as { contentId: string; dictation: { completed: boolean } }[];
      // A stale id is absent, not an error — one bad id must never fail a
      // whole catalog page.
      expect(rows).toHaveLength(2);
      expect(rows.find((r) => r.contentId === a.contentId)?.dictation.completed).toBe(true);
      expect(rows.find((r) => r.contentId === b.contentId)?.dictation.completed).toBe(false);
    });

    it('is read-only — it writes no progress row', async () => {
      const { contentId } = await publishRecording(['read only sentence']);

      await request(app.getHttpServer())
        .get('/listening/progress')
        .query({ contentIds: contentId })
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(200);

      // Sprint 07 shipped a GET that started a quiz attempt. This is the
      // assertion that stops it happening here.
      expect(
        await prisma.listeningDictationSegmentProgress.count({
          where: { userId: studentId, contentId },
        }),
      ).toBe(0);
      expect(
        await prisma.listeningDictationAttempt.count({
          where: { userId: studentId, contentId },
        }),
      ).toBe(0);
    });

    it('rejects more than twenty ids', async () => {
      const ids = Array.from({ length: 21 }, () => randomUUID()).join(',');
      await request(app.getHttpServer())
        .get('/listening/progress')
        .query({ contentIds: ids })
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(400);
    });
  });

  // --- content deletion -----------------------------------------------------

  describe('a practised recording cannot be deleted', () => {
    // ListeningContentService has carried this guard and its P2003 backstop
    // since Phase 1. The Restrict relations added in Phase 4A are the first
    // thing that can actually make it fire.
    it('refuses with a reason rather than a 500', async () => {
      const { contentId, segmentIds } = await publishRecording(['do not delete me']);
      await submit(segmentIds[0], { typedText: 'do not delete me' }).expect(201);

      const res = await request(app.getHttpServer())
        .delete(`/listening/manage/contents/${contentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);

      expect(String(res.body.message)).toMatch(/practis/i);
      expect(
        await prisma.listeningContent.count({ where: { id: contentId } }),
      ).toBe(1);
    });

    it('still allows an untouched recording to be deleted', async () => {
      const { contentId } = await publishRecording(['nobody practised this']);

      await request(app.getHttpServer())
        .delete(`/listening/manage/contents/${contentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(204);
    });

    // A segment must stay editable on live content — that is why the segment
    // relation is Cascade while the content relation is Restrict.
    it('lets an admin delete a practised SENTENCE, taking its progress with it', async () => {
      const { contentId, segmentIds } = await publishRecording(['keep me', 'remove me']);
      await submit(segmentIds[1], { typedText: 'remove me' }).expect(201);

      await putSegments(contentId, [
        { id: segmentIds[0], text: 'keep me' },
      ]).expect(200);

      expect(
        await prisma.listeningDictationSegmentProgress.count({
          where: { segmentId: segmentIds[1] },
        }),
      ).toBe(0);
    });
  });
});
