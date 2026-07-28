import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { testFixtureName, TEST_FIXTURE_PREFIX } from './test-database.util';

// Sprint 05 — the Grammar module landing page shows a lesson count per
// course, so `GET /courses` gained a relation count filtered to PUBLISHED
// lessons. This suite is the proof that the filter actually filters: a
// student must never be told a course has N lessons when some of them are
// drafts they cannot open, and admins must keep seeing the true total.
//
// Requires `docker-compose up -d` and runs against the dedicated test
// database (test/test-database.util.ts refuses anything else). Every
// fixture is named through `testFixtureName()` so the global sweep can
// remove it even if this file's own `afterAll` never runs.
describe('Course module (e2e) — Sprint 05: published-lesson counts', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const createdUserEmails: string[] = [];
  let courseId: string;
  let adminToken: string;

  const registerAndLogin = async (): Promise<string> => {
    const email = `sprint05-${randomUUID()}@example.test`;
    createdUserEmails.push(email);
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: 'Sprint 05 Test User', email, password: 'password123' });
    return (res.body as { accessToken: string }).accessToken;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    await app.init();

    prisma = app.get(PrismaService);

    // A published course carrying TWO published lessons and ONE draft, so
    // the filtered and unfiltered counts genuinely differ (2 vs 3). Without
    // a draft in the fixture this suite would pass even if the `where` were
    // deleted.
    const course = await prisma.course.create({
      data: {
        title: testFixtureName('Grammar Fundamentals E2E'),
        type: 'GRAMMAR',
        description: 'fixture course',
        isPublished: true,
      },
    });
    courseId = course.id;

    await prisma.lesson.createMany({
      data: [
        {
          courseId,
          title: testFixtureName('Published Lesson One'),
          orderIndex: 0,
          isPublished: true,
          videoUrl: 'https://youtu.be/fixture1',
          estimatedStudyMinutes: 15,
        },
        {
          courseId,
          title: testFixtureName('Published Lesson Two'),
          orderIndex: 1,
          isPublished: true,
          videoUrl: 'https://youtu.be/fixture2',
          estimatedStudyMinutes: 10,
        },
        {
          courseId,
          title: testFixtureName('Draft Lesson'),
          orderIndex: 2,
          isPublished: false,
          videoUrl: 'https://youtu.be/fixture3',
        },
      ],
    });

    // Promoted directly in the database — there is no self-service route to
    // become an admin, by design.
    const email = `sprint05-admin-${randomUUID()}@example.test`;
    createdUserEmails.push(email);
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: 'Sprint 05 Admin', email, password: 'password123' });
    await prisma.user.update({ where: { email }, data: { role: 'ADMIN' } });
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'password123', role: 'ADMIN' });
    adminToken = (login.body as { accessToken: string }).accessToken;
  });

  afterAll(async () => {
    await prisma.lesson.deleteMany({ where: { courseId } });
    await prisma.course.deleteMany({ where: { id: courseId } });
    if (createdUserEmails.length) {
      await prisma.user.deleteMany({
        where: { email: { in: createdUserEmails } },
      });
    }
    await app.close();
  });

  describe('GET /courses (public)', () => {
    it('counts only published lessons', async () => {
      const res = await request(app.getHttpServer())
        .get('/courses?limit=100&type=GRAMMAR')
        .expect(200);

      const course = (
        res.body as { data: { id: string; _count: { lessons: number } }[] }
      ).data.find((row) => row.id === courseId);
      expect(course).toBeDefined();
      // Three lessons exist; one is a draft.
      expect(course!._count.lessons).toBe(2);
    });

    it('returns the same filtered count on the single-course endpoint', async () => {
      const res = await request(app.getHttpServer())
        .get(`/courses/${courseId}`)
        .expect(200);

      expect((res.body as { _count: { lessons: number } })._count.lessons).toBe(
        2,
      );
    });

    it('reports zero rather than omitting the count for a course with no published lessons', async () => {
      const empty = await prisma.course.create({
        data: {
          title: testFixtureName('Empty Course E2E'),
          type: 'GRAMMAR',
          description: 'fixture course with no lessons',
          isPublished: true,
        },
      });

      try {
        const res = await request(app.getHttpServer())
          .get(`/courses/${empty.id}`)
          .expect(200);
        expect(
          (res.body as { _count: { lessons: number } })._count.lessons,
        ).toBe(0);
      } finally {
        await prisma.course.delete({ where: { id: empty.id } });
      }
    });
  });

  describe('GET /courses/manage (admin)', () => {
    it('still counts drafts, so admin totals did not silently change', async () => {
      const res = await request(app.getHttpServer())
        .get('/courses/manage?limit=100')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const course = (
        res.body as { data: { id: string; _count: { lessons: number } }[] }
      ).data.find((row) => row.id === courseId);
      expect(course).toBeDefined();
      // MANAGE_SELECT spreads PUBLIC_SELECT, so this asserts the explicit
      // override is still in place — without it admins would lose sight of
      // their own drafts.
      expect(course!._count.lessons).toBe(3);
    });
  });

  describe('fixture containment (Sprint 04D regression guard)', () => {
    it('keeps every fixture inside the test namespace', async () => {
      const course = await prisma.course.findUnique({
        where: { id: courseId },
      });
      expect(course!.title.startsWith(TEST_FIXTURE_PREFIX)).toBe(true);

      const lessons = await prisma.lesson.findMany({ where: { courseId } });
      expect(lessons).toHaveLength(3);
      lessons.forEach((lesson) =>
        expect(lesson.title.startsWith(TEST_FIXTURE_PREFIX)).toBe(true),
      );
    });

    it('a student listing returns no course outside the test namespace beyond real content', async () => {
      const token = await registerAndLogin();
      const res = await request(app.getHttpServer())
        .get('/courses?limit=100')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // The test database holds only this suite's fixtures, so anything
      // published here must be namespaced. On a polluted database this fails
      // loudly instead of silently shipping strays to students.
      const strays = (res.body as { data: { title: string }[] }).data.filter(
        (row) => !row.title.startsWith(TEST_FIXTURE_PREFIX),
      );
      expect(strays).toEqual([]);
    });
  });
});
