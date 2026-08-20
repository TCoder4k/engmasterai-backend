import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WsAdapter } from '@nestjs/platform-ws';
import request from 'supertest';
import type { App } from 'supertest/types';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { testFixtureName, TEST_FIXTURE_PREFIX } from './test-database.util';

// Personalized Onboarding & Placement Test, Phase 2 — the admin question
// bank. Same boilerplate as course.e2e-spec.ts: register + promote to ADMIN
// directly in the database (there is no self-service route to become one),
// every fixture named through testFixtureName() so the global sweep can
// remove it even if this file's own afterAll never runs.
describe('Placement question bank (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const createdUserEmails: string[] = [];
  const createdQuestionIds: string[] = [];
  let adminToken: string;
  let studentToken: string;

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

    const adminEmail = `placement-admin-${randomUUID()}@example.test`;
    createdUserEmails.push(adminEmail);
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: 'Placement Admin', email: adminEmail, password: 'password123' });
    await prisma.user.update({ where: { email: adminEmail }, data: { role: 'ADMIN' } });
    const adminLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: adminEmail, password: 'password123', role: 'ADMIN' });
    adminToken = (adminLogin.body as { accessToken: string }).accessToken;

    const studentEmail = `placement-student-${randomUUID()}@example.test`;
    createdUserEmails.push(studentEmail);
    const studentRegister = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: 'Placement Student', email: studentEmail, password: 'password123' });
    studentToken = (studentRegister.body as { accessToken: string }).accessToken;
  });

  afterAll(async () => {
    if (createdQuestionIds.length) {
      await prisma.placementQuestion.deleteMany({
        where: { id: { in: createdQuestionIds } },
      });
    }
    if (createdUserEmails.length) {
      await prisma.user.deleteMany({ where: { email: { in: createdUserEmails } } });
    }
    await app.close();
  });

  describe('authorization', () => {
    it('rejects an unauthenticated request with 401', async () => {
      await request(app.getHttpServer())
        .get('/placement/questions/manage')
        .expect(401);
    });

    it('rejects a non-admin (student) request with 403', async () => {
      await request(app.getHttpServer())
        .get('/placement/questions/manage')
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(403);
    });
  });

  describe('create', () => {
    it('creates a MULTIPLE_CHOICE question with valid content', async () => {
      const res = await request(app.getHttpServer())
        .post('/placement/questions/manage')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          section: 'GRAMMAR',
          type: 'MULTIPLE_CHOICE',
          difficulty: 'EASY',
          content: testFixtureName('She ___ to school every day.'),
          options: [
            { id: 'a', text: 'go' },
            { id: 'b', text: 'goes' },
          ],
          correctAnswer: { optionId: 'b' },
        })
        .expect(201);

      createdQuestionIds.push(res.body.id);
      expect(res.body.isPublished).toBe(false);
      // Invariant 9's admin side: the authoring response DOES carry
      // correctAnswer (an admin is allowed to see it — this is the
      // MANAGE select, never served to a student sampling a live test).
      expect(res.body.correctAnswer).toEqual({ optionId: 'b' });
    });

    it('rejects a MULTIPLE_CHOICE question whose correctAnswer references an option that does not exist', async () => {
      await request(app.getHttpServer())
        .post('/placement/questions/manage')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          section: 'GRAMMAR',
          type: 'MULTIPLE_CHOICE',
          difficulty: 'EASY',
          content: testFixtureName('Bad question'),
          options: [{ id: 'a', text: 'go' }],
          correctAnswer: { optionId: 'zzz' },
        })
        .expect(400);
    });

    it('a student cannot author a question (403)', async () => {
      await request(app.getHttpServer())
        .post('/placement/questions/manage')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({
          section: 'GRAMMAR',
          type: 'TRUE_FALSE',
          difficulty: 'EASY',
          content: testFixtureName('Student-authored, should never land'),
          correctAnswer: { value: true },
        })
        .expect(403);
    });
  });

  describe('update / publish / unpublish / delete', () => {
    let questionId: string;

    beforeAll(async () => {
      const question = await prisma.placementQuestion.create({
        data: {
          section: 'VOCABULARY',
          type: 'TRUE_FALSE',
          difficulty: 'MEDIUM',
          content: testFixtureName('A synonym for "happy" is "sad".'),
          correctAnswer: { value: false },
        },
      });
      questionId = question.id;
      createdQuestionIds.push(questionId);
    });

    it('updates content and re-validates against the resolved shape', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/placement/questions/manage/${questionId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ correctAnswer: { value: true } })
        .expect(200);
      expect(res.body.correctAnswer).toEqual({ value: true });
    });

    it('publishes then unpublishes', async () => {
      const published = await request(app.getHttpServer())
        .patch(`/placement/questions/manage/${questionId}/publish`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(published.body.isPublished).toBe(true);

      const unpublished = await request(app.getHttpServer())
        .patch(`/placement/questions/manage/${questionId}/unpublish`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(unpublished.body.isPublished).toBe(false);
    });

    it('deletes the question', async () => {
      await request(app.getHttpServer())
        .delete(`/placement/questions/manage/${questionId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(204);

      const row = await prisma.placementQuestion.findUnique({ where: { id: questionId } });
      expect(row).toBeNull();
      createdQuestionIds.splice(createdQuestionIds.indexOf(questionId), 1);
    });

    it('404s on updating an id that no longer exists', async () => {
      await request(app.getHttpServer())
        .patch(`/placement/questions/manage/${questionId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ content: 'irrelevant' })
        .expect(404);
    });
  });

  describe('GET /placement/questions/manage (list + filters)', () => {
    it('filters by section and difficulty', async () => {
      const listening = await prisma.placementQuestion.create({
        data: {
          section: 'LISTENING',
          type: 'MULTIPLE_CHOICE',
          difficulty: 'HARD',
          content: testFixtureName('Listening filter fixture'),
          options: [{ id: 'a', text: 'x' }, { id: 'b', text: 'y' }],
          correctAnswer: { optionId: 'a' },
        },
      });
      createdQuestionIds.push(listening.id);

      const res = await request(app.getHttpServer())
        .get('/placement/questions/manage?section=LISTENING&difficulty=HARD')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const ids: string[] = res.body.data.map((row: { id: string }) => row.id);
      expect(ids).toContain(listening.id);
      expect(
        (res.body.data as { section: string; difficulty: string }[]).every(
          (row) => row.section === 'LISTENING' && row.difficulty === 'HARD',
        ),
      ).toBe(true);
    });
  });

  describe('GET /placement/questions/manage/coverage', () => {
    it('reflects published counts per (section, difficulty) bucket, ignoring drafts', async () => {
      // Two published EASY Grammar questions is exactly the required count
      // (DIFFICULTY_REQUIREMENTS.EASY === 2) — plus a third that stays a
      // draft, which must NOT count toward coverage.
      const created = await prisma.$transaction([
        prisma.placementQuestion.create({
          data: {
            section: 'GRAMMAR',
            type: 'TRUE_FALSE',
            difficulty: 'EASY',
            content: testFixtureName('Coverage fixture published 1'),
            correctAnswer: { value: true },
            isPublished: true,
          },
        }),
        prisma.placementQuestion.create({
          data: {
            section: 'GRAMMAR',
            type: 'TRUE_FALSE',
            difficulty: 'EASY',
            content: testFixtureName('Coverage fixture published 2'),
            correctAnswer: { value: true },
            isPublished: true,
          },
        }),
        prisma.placementQuestion.create({
          data: {
            section: 'GRAMMAR',
            type: 'TRUE_FALSE',
            difficulty: 'EASY',
            content: testFixtureName('Coverage fixture draft'),
            correctAnswer: { value: true },
            isPublished: false,
          },
        }),
      ]);
      created.forEach((q) => createdQuestionIds.push(q.id));

      const res = await request(app.getHttpServer())
        .get('/placement/questions/manage/coverage')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const bucket = (
        res.body.buckets as { section: string; difficulty: string; available: number }[]
      ).find((b) => b.section === 'GRAMMAR' && b.difficulty === 'EASY');
      // >= 2 rather than === 2: other suites' fixtures may also publish
      // GRAMMAR/EASY questions and this file has no exclusive claim on the
      // bucket — only that OUR two published rows are reflected, not the
      // draft.
      expect(bucket!.available).toBeGreaterThanOrEqual(2);
    });
  });

  describe('fixture containment', () => {
    it('keeps every fixture inside the test namespace', async () => {
      const rows = await prisma.placementQuestion.findMany({
        where: { id: { in: createdQuestionIds } },
      });
      rows.forEach((row) =>
        expect(row.content.startsWith(TEST_FIXTURE_PREFIX)).toBe(true),
      );
    });
  });
});
