import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { testFixtureName } from './test-database.util';

// Sprint 11 — Listening content (e2e).
//
// The four properties this suite exists to pin, all of which are cheap to
// break and expensive to notice:
//
//   1. THE TWO-LEVEL VISIBILITY RULE. A recording is student-visible only when
//      it AND its category are published, and every failure mode produces the
//      SAME 404. An enumeration hole here would be silent.
//   2. SEGMENT IDS SURVIVE AN EDIT. From Phase 4A a segment carries student
//      progress and attempt history that cascade from it, so a whole-document
//      save that recreated rows would destroy that history invisibly.
//   3. REORDERING WORKS. `@@unique([contentId, orderIndex])` is checked per
//      statement, so a naive implementation fails the moment two sentences
//      swap places.
//   4. PUBLISH VALIDATION REFUSES WITH A REASON, never a 500.
//
// Requires `docker compose up -d` and the dedicated test database
// (test-database.util.ts refuses anything else). Every fixture is named
// through testFixtureName() so the global sweep removes it even if this file's
// own afterAll never runs.
describe('Listening module (e2e) — Sprint 11: content authoring', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const createdUserEmails: string[] = [];
  let adminToken: string;
  let studentToken: string;
  let categoryId: string;

  const YOUTUBE_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

  const registerStudent = async (): Promise<string> => {
    const email = `sprint11-student-${randomUUID()}@example.test`;
    createdUserEmails.push(email);
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: 'Sprint 11 Student', email, password: 'password123' });
    return (res.body as { accessToken: string }).accessToken;
  };

  /** Creates a draft content in the shared fixture category. */
  const createContent = async (
    overrides: Record<string, unknown> = {},
  ): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/listening/manage/contents')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        categoryId,
        title: testFixtureName('Content'),
        level: 'B1',
        mediaType: 'VIDEO',
        mediaProvider: 'YOUTUBE',
        mediaUrl: YOUTUBE_URL,
        sourceName: 'Fixture Channel',
        sourceUrl: 'https://www.youtube.com/@fixture',
        durationMs: 60_000,
        supportedModes: ['DICTATION'],
        ...overrides,
      })
      .expect(201);
    return (res.body as { id: string }).id;
  };

  const putSegments = (contentId: string, segments: unknown[]) =>
    request(app.getHttpServer())
      .put(`/listening/manage/contents/${contentId}/segments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ segments });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    await app.init();

    prisma = app.get(PrismaService);

    const email = `sprint11-admin-${randomUUID()}@example.test`;
    createdUserEmails.push(email);
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: 'Sprint 11 Admin', email, password: 'password123' });
    await prisma.user.update({ where: { email }, data: { role: 'ADMIN' } });
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'password123', role: 'ADMIN' });
    adminToken = (login.body as { accessToken: string }).accessToken;

    studentToken = await registerStudent();

    const category = await prisma.listeningCategory.create({
      data: {
        name: testFixtureName('Category'),
        nameVi: testFixtureName('Danh mục'),
        orderIndex: 0,
        isPublished: true,
      },
    });
    categoryId = category.id;
  });

  afterAll(async () => {
    await prisma.listeningContent.deleteMany({ where: { categoryId } });
    await prisma.listeningCategory.deleteMany({ where: { id: categoryId } });
    await prisma.user.deleteMany({
      where: { email: { in: createdUserEmails } },
    });
    await app.close();
  });

  // --- authorization --------------------------------------------------------

  describe('authorization', () => {
    it('rejects an unauthenticated student read', async () => {
      await request(app.getHttpServer()).get('/listening/catalog').expect(401);
    });

    it('rejects an unauthenticated admin route', async () => {
      await request(app.getHttpServer())
        .get('/listening/manage/contents')
        .expect(401);
    });

    it('rejects a STUDENT on every admin route', async () => {
      const auth = `Bearer ${studentToken}`;
      await request(app.getHttpServer())
        .get('/listening/manage/contents')
        .set('Authorization', auth)
        .expect(403);
      await request(app.getHttpServer())
        .get('/listening/manage/categories')
        .set('Authorization', auth)
        .expect(403);
      await request(app.getHttpServer())
        .post('/listening/manage/contents')
        .set('Authorization', auth)
        .send({})
        .expect(403);
    });

    it('allows an authenticated student to read the catalog', async () => {
      await request(app.getHttpServer())
        .get('/listening/catalog')
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(200);
    });
  });

  // --- visibility (the anti-probing rule) -----------------------------------

  describe('visibility', () => {
    it('hides a DRAFT content and 404s identically to a missing one', async () => {
      const contentId = await createContent();

      const draftRes = await request(app.getHttpServer())
        .get(`/listening/contents/${contentId}`)
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(404);

      const missingRes = await request(app.getHttpServer())
        .get(`/listening/contents/${randomUUID()}`)
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(404);

      // The messages differ only by the id echoed back. If a future change
      // makes one of them say "draft", this assertion is what catches it.
      expect(draftRes.body.message).toBe(
        `Listening content with ID ${contentId} not found`,
      );
      expect(missingRes.body.message).toMatch(
        /^Listening content with ID .+ not found$/,
      );
    });

    it('hides published content whose CATEGORY is a draft — the kill switch', async () => {
      const draftCategory = await prisma.listeningCategory.create({
        data: {
          name: testFixtureName('Draft Category'),
          nameVi: testFixtureName('Danh mục nháp'),
          orderIndex: 1,
          isPublished: false,
        },
      });

      const contentId = await createContent({ categoryId: draftCategory.id });
      await putSegments(contentId, [
        { text: 'Hello there.', startTimeMs: 0, endTimeMs: 3_000 },
      ]).expect(200);

      // Publishing into a draft category is refused outright...
      const publishRes = await request(app.getHttpServer())
        .patch(`/listening/manage/contents/${contentId}/publish`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
      expect(publishRes.body.message).toContain(
        'the category is still a draft',
      );

      // ...and even with isPublished forced on directly, the two-level
      // predicate still hides it. This is the assertion that proves the
      // category half of the rule is real rather than only enforced at publish.
      await prisma.listeningContent.update({
        where: { id: contentId },
        data: { isPublished: true },
      });

      await request(app.getHttpServer())
        .get(`/listening/contents/${contentId}`)
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(404);

      const catalog = await request(app.getHttpServer())
        .get('/listening/catalog')
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(200);
      expect(
        (catalog.body.data as { id: string }[]).some((c) => c.id === contentId),
      ).toBe(false);
      expect(
        (catalog.body.categories as { id: string }[]).some(
          (c) => c.id === draftCategory.id,
        ),
      ).toBe(false);

      await prisma.listeningContent.deleteMany({
        where: { categoryId: draftCategory.id },
      });
      await prisma.listeningCategory.delete({
        where: { id: draftCategory.id },
      });
    });

    it('shows content once BOTH it and its category are published, and hides it again on unpublish', async () => {
      const contentId = await createContent();
      await putSegments(contentId, [
        { text: 'Good morning everyone.', startTimeMs: 0, endTimeMs: 4_000 },
        { text: 'Welcome aboard.', startTimeMs: 4_000, endTimeMs: 8_000 },
      ]).expect(200);

      await request(app.getHttpServer())
        .patch(`/listening/manage/contents/${contentId}/publish`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const visible = await request(app.getHttpServer())
        .get(`/listening/contents/${contentId}`)
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(200);
      expect(visible.body.segments).toHaveLength(2);

      // Unpublishing the CATEGORY removes it without touching the content.
      await request(app.getHttpServer())
        .patch(`/listening/manage/categories/${categoryId}/unpublish`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .get(`/listening/contents/${contentId}`)
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(404);

      // Re-publishing the category restores the previous state exactly —
      // the content kept its own isPublished throughout.
      await request(app.getHttpServer())
        .patch(`/listening/manage/categories/${categoryId}/publish`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .get(`/listening/contents/${contentId}`)
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(200);
    });

    it('never leaks normalizedText or notes to a student', async () => {
      const contentId = await createContent();
      await putSegments(contentId, [
        {
          text: "Don't forget the meeting.",
          notes: 'Author note: watch the contraction.',
          startTimeMs: 0,
          endTimeMs: 4_000,
        },
      ]).expect(200);
      await request(app.getHttpServer())
        .patch(`/listening/manage/contents/${contentId}/publish`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const res = await request(app.getHttpServer())
        .get(`/listening/contents/${contentId}`)
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(200);

      const [segment] = res.body.segments as Record<string, unknown>[];
      expect(segment).not.toHaveProperty('normalizedText');
      expect(segment).not.toHaveProperty('notes');
      // The whole payload, not just the one field — a widened select would
      // otherwise slip through anywhere else in the tree.
      expect(JSON.stringify(res.body)).not.toContain('Author note');
    });
  });

  // --- segment document -----------------------------------------------------

  describe('segment whole-document upsert', () => {
    it('KEEPS the id of a segment that survives an edit', async () => {
      const contentId = await createContent();

      const first = await putSegments(contentId, [
        { text: 'First sentence.', startTimeMs: 0, endTimeMs: 3_000 },
        { text: 'Second sentence.', startTimeMs: 3_000, endTimeMs: 6_000 },
      ]).expect(200);

      const [a, b] = first.body.segments as { id: string; text: string }[];

      const second = await putSegments(contentId, [
        {
          id: a.id,
          text: 'First sentence, corrected.',
          startTimeMs: 0,
          endTimeMs: 3_000,
        },
        {
          id: b.id,
          text: 'Second sentence.',
          startTimeMs: 3_000,
          endTimeMs: 6_000,
        },
      ]).expect(200);

      const after = second.body.segments as { id: string; text: string }[];
      // THE assertion of this suite. If these ids change, every student's
      // progress and attempt history for this recording would be destroyed
      // by an unrelated typo fix once Phase 4A lands.
      expect(after[0].id).toBe(a.id);
      expect(after[1].id).toBe(b.id);
      expect(after[0].text).toBe('First sentence, corrected.');
    });

    it('creates rows for entries with no id and deletes ones left out', async () => {
      const contentId = await createContent();

      const first = await putSegments(contentId, [
        { text: 'Keep me.', startTimeMs: 0, endTimeMs: 3_000 },
        { text: 'Drop me.', startTimeMs: 3_000, endTimeMs: 6_000 },
      ]).expect(200);
      const [keep, drop] = first.body.segments as { id: string }[];

      const second = await putSegments(contentId, [
        { id: keep.id, text: 'Keep me.', startTimeMs: 0, endTimeMs: 3_000 },
        { text: 'Brand new.', startTimeMs: 6_000, endTimeMs: 9_000 },
      ]).expect(200);

      const after = second.body.segments as { id: string; text: string }[];
      expect(after).toHaveLength(2);
      expect(after[0].id).toBe(keep.id);
      expect(after.map((s) => s.text)).toEqual(['Keep me.', 'Brand new.']);
      expect(after.some((s) => s.id === drop.id)).toBe(false);

      const remaining = await prisma.listeningSegment.count({
        where: { contentId },
      });
      expect(remaining).toBe(2);
    });

    it('REORDERS without tripping the (contentId, orderIndex) unique constraint', async () => {
      const contentId = await createContent();

      const first = await putSegments(contentId, [
        { text: 'Alpha.', startTimeMs: 0, endTimeMs: 3_000 },
        { text: 'Bravo.', startTimeMs: 3_000, endTimeMs: 6_000 },
        { text: 'Charlie.', startTimeMs: 6_000, endTimeMs: 9_000 },
      ]).expect(200);
      const [alpha, bravo, charlie] = first.body.segments as { id: string }[];

      // Full reversal — the worst case for a per-statement unique check.
      const second = await putSegments(contentId, [
        { id: charlie.id, text: 'Charlie.', startTimeMs: 0, endTimeMs: 3_000 },
        { id: bravo.id, text: 'Bravo.', startTimeMs: 3_000, endTimeMs: 6_000 },
        { id: alpha.id, text: 'Alpha.', startTimeMs: 6_000, endTimeMs: 9_000 },
      ]).expect(200);

      const after = second.body.segments as {
        id: string;
        text: string;
        orderIndex: number;
      }[];
      expect(after.map((s) => s.text)).toEqual([
        'Charlie.',
        'Bravo.',
        'Alpha.',
      ]);
      expect(after.map((s) => s.orderIndex)).toEqual([0, 1, 2]);
      // Ids preserved through the reorder, not recreated.
      expect(after.map((s) => s.id)).toEqual([charlie.id, bravo.id, alpha.id]);
    });

    it('accepts an empty document — clearing a draft is legal', async () => {
      const contentId = await createContent();
      await putSegments(contentId, [
        { text: 'Temporary.', startTimeMs: 0, endTimeMs: 3_000 },
      ]).expect(200);

      const cleared = await putSegments(contentId, []).expect(200);
      expect(cleared.body.segments).toHaveLength(0);
    });

    it('rejects a segment whose end is not after its start, with a specific message', async () => {
      const contentId = await createContent();
      const res = await putSegments(contentId, [
        { text: 'Bad timing.', startTimeMs: 5_000, endTimeMs: 5_000 },
      ]).expect(400);
      expect(res.body.message).toBe(
        'Segment 1: endTimeMs (5000) must be greater than startTimeMs (5000).',
      );
    });

    it('404s for a content that does not exist', async () => {
      await putSegments(randomUUID(), []).expect(404);
    });

    it('stores normalizedText computed by the server, not sent by the client', async () => {
      const contentId = await createContent();
      await putSegments(contentId, [
        {
          text: '  Don’t   FORGET, please!  ',
          startTimeMs: 0,
          endTimeMs: 3_000,
          // A client attempting to supply its own normalized form. The DTO has
          // no such field, so it cannot reach the column.
          normalizedText: 'anything at all',
        },
      ]).expect(200);

      const stored = await prisma.listeningSegment.findFirst({
        where: { contentId },
        select: { text: true, normalizedText: true },
      });
      expect(stored?.text).toBe('Don’t   FORGET, please!');
      expect(stored?.normalizedText).toBe("don't forget please");
    });
  });

  // --- publish validation ---------------------------------------------------

  describe('publish validation', () => {
    it('refuses content with no segments, naming the reason', async () => {
      const contentId = await createContent();
      const res = await request(app.getHttpServer())
        .patch(`/listening/manage/contents/${contentId}/publish`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
      expect(res.body.message).toBe(
        'Cannot publish: add at least one segment.',
      );
    });

    it('refuses content with no media — the state every seeded recording is in', async () => {
      const contentId = await createContent({ mediaUrl: '' });
      await putSegments(contentId, [
        { text: 'Hello.', startTimeMs: 0, endTimeMs: 3_000 },
      ]).expect(200);

      const res = await request(app.getHttpServer())
        .patch(`/listening/manage/contents/${contentId}/publish`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
      expect(res.body.message).toBe('Cannot publish: add a media URL.');
    });

    it('refuses YouTube media with no attribution', async () => {
      const contentId = await createContent({ sourceName: '', sourceUrl: '' });
      await putSegments(contentId, [
        { text: 'Hello.', startTimeMs: 0, endTimeMs: 3_000 },
      ]).expect(200);

      const res = await request(app.getHttpServer())
        .patch(`/listening/manage/contents/${contentId}/publish`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
      expect(res.body.message).toContain('source/channel name');
    });

    it('refuses content with no enabled mode', async () => {
      const contentId = await createContent({ supportedModes: [] });
      await putSegments(contentId, [
        { text: 'Hello.', startTimeMs: 0, endTimeMs: 3_000 },
      ]).expect(200);

      const res = await request(app.getHttpServer())
        .patch(`/listening/manage/contents/${contentId}/publish`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
      expect(res.body.message).toBe(
        'Cannot publish: enable at least one practice mode.',
      );
    });

    it('refuses overlapping segments', async () => {
      const contentId = await createContent();
      await putSegments(contentId, [
        { text: 'One.', startTimeMs: 0, endTimeMs: 5_000 },
        { text: 'Two.', startTimeMs: 3_000, endTimeMs: 8_000 },
      ]).expect(200);

      const res = await request(app.getHttpServer())
        .patch(`/listening/manage/contents/${contentId}/publish`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
      expect(res.body.message).toContain('before segment 1 ends');
    });
  });

  // --- write protection -----------------------------------------------------

  describe('write protection', () => {
    it('ignores a client-supplied isPublished on create', async () => {
      // The DTO has no such field and the service constructs its payload
      // explicitly, so this cannot reach the column even though the global
      // ValidationPipe is bare and leaves the property on req.body.
      const res = await request(app.getHttpServer())
        .post('/listening/manage/contents')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          categoryId,
          title: testFixtureName('Sneaky'),
          level: 'B1',
          mediaType: 'VIDEO',
          mediaProvider: 'YOUTUBE',
          mediaUrl: YOUTUBE_URL,
          supportedModes: ['DICTATION'],
          isPublished: true,
        })
        .expect(201);

      expect(res.body.isPublished).toBe(false);
    });

    it('rejects a create pointing at a category that does not exist', async () => {
      await request(app.getHttpServer())
        .post('/listening/manage/contents')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          categoryId: randomUUID(),
          title: testFixtureName('Orphan'),
          level: 'B1',
          mediaType: 'VIDEO',
          mediaProvider: 'YOUTUBE',
          mediaUrl: YOUTUBE_URL,
          supportedModes: ['DICTATION'],
        })
        .expect(400);
    });

    it('rejects a non-UUID content id rather than reaching the service', async () => {
      await request(app.getHttpServer())
        .get('/listening/contents/office-relocation-notice')
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(400);
    });
  });

  // --- category lifecycle ---------------------------------------------------

  describe('category lifecycle', () => {
    it('refuses to delete a category that still holds content', async () => {
      const contentId = await createContent();

      const res = await request(app.getHttpServer())
        .delete(`/listening/manage/categories/${categoryId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
      expect(res.body.message).toContain('still has listening content');

      await request(app.getHttpServer())
        .delete(`/listening/manage/contents/${contentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(204);
    });

    it('deletes a content and cascades its segments away', async () => {
      const contentId = await createContent();
      await putSegments(contentId, [
        { text: 'Gone soon.', startTimeMs: 0, endTimeMs: 3_000 },
      ]).expect(200);

      await request(app.getHttpServer())
        .delete(`/listening/manage/contents/${contentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(204);

      expect(
        await prisma.listeningSegment.count({ where: { contentId } }),
      ).toBe(0);
    });

    it('allows moving content between categories', async () => {
      const other = await prisma.listeningCategory.create({
        data: {
          name: testFixtureName('Other Category'),
          nameVi: testFixtureName('Danh mục khác'),
          orderIndex: 9,
          isPublished: true,
        },
      });
      const contentId = await createContent();

      const res = await request(app.getHttpServer())
        .patch(`/listening/manage/contents/${contentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ categoryId: other.id })
        .expect(200);
      expect(res.body.categoryId).toBe(other.id);

      await prisma.listeningContent.delete({ where: { id: contentId } });
      await prisma.listeningCategory.delete({ where: { id: other.id } });
    });
  });

  // --- reads are read-only --------------------------------------------------

  describe('reads write nothing', () => {
    it('GET catalog and GET content create no rows and do not change updatedAt', async () => {
      const contentId = await createContent();
      await putSegments(contentId, [
        { text: 'Stable.', startTimeMs: 0, endTimeMs: 3_000 },
      ]).expect(200);
      await request(app.getHttpServer())
        .patch(`/listening/manage/contents/${contentId}/publish`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const before = await prisma.listeningContent.findUniqueOrThrow({
        where: { id: contentId },
        select: { updatedAt: true },
      });
      const segmentsBefore = await prisma.listeningSegment.count();

      await request(app.getHttpServer())
        .get('/listening/catalog')
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(200);
      await request(app.getHttpServer())
        .get(`/listening/contents/${contentId}`)
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(200);

      const after = await prisma.listeningContent.findUniqueOrThrow({
        where: { id: contentId },
        select: { updatedAt: true },
      });
      expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
      expect(await prisma.listeningSegment.count()).toBe(segmentsBefore);
    });

    it('reports catalog counts derived from published content only', async () => {
      const res = await request(app.getHttpServer())
        .get('/listening/catalog')
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(200);

      const fixtureCategory = (
        res.body.categories as { id: string; contentCount: number }[]
      ).find((c) => c.id === categoryId);

      const publishedCount = await prisma.listeningContent.count({
        where: { categoryId, isPublished: true },
      });

      // The chip count must equal the real number of visible recordings —
      // never the page size, and never a hardcoded figure.
      expect(fixtureCategory?.contentCount).toBe(publishedCount);
    });
  });
});
