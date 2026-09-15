import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WsAdapter } from '@nestjs/platform-ws';
import request from 'supertest';
import type { App } from 'supertest/types';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { testFixtureName } from './test-database.util';

// TrustedOriginGuard (CSRF defense for cookie-only endpoints) gates
// /auth/refresh — matches CORS_ALLOWED_ORIGINS in .env.test.example, same
// constant test/auth.e2e-spec.ts uses.
const TRUSTED_ORIGIN = 'http://localhost:5174';

// Sprint 15 — Admin student management (GET /users/overview,
// GET /users/:id/overview, PATCH /users/:id/status), plus the isActive
// enforcement this feature adds to login/refresh. Fixture rows for
// LessonTaskAttempt/SpeakingAttempt/Roadmap/Payment/Subscription are
// inserted directly via Prisma rather than replayed through their own real
// HTTP flows — this suite is verifying the ADMIN AGGREGATION and the
// blocking behavior, not re-proving the quiz/speaking/payment engines
// themselves (each already has its own e2e suite for that).
describe('Admin student management (e2e) — Sprint 15', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const createdUserIds: string[] = [];
  const createdCourseIds: string[] = [];

  const registerAndLogin = async (
    label: string,
    role: 'USER' | 'ADMIN' = 'USER',
  ): Promise<{ token: string; userId: string; email: string }> => {
    const email = `s15-${label.slice(0, 16)}-${randomUUID()}@example.test`;
    const register = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: `Sprint 15 ${label}`, email, password: 'password123' });
    const userId = (register.body as { user: { id: string } }).user.id;
    createdUserIds.push(userId);

    if (role === 'ADMIN') {
      await prisma.user.update({ where: { email }, data: { role: 'ADMIN' } });
    }

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'password123', role });
    return {
      token: (login.body as { accessToken: string }).accessToken,
      userId,
      email,
    };
  };

  const createPublishedTask = async (): Promise<{
    courseId: string;
    lessonId: string;
    taskId: string;
  }> => {
    const course = await prisma.course.create({
      data: {
        title: testFixtureName('s15-course'),
        type: 'GRAMMAR',
        description: 'fixture course',
        isPublished: true,
      },
    });
    createdCourseIds.push(course.id);
    const lesson = await prisma.lesson.create({
      data: {
        courseId: course.id,
        title: testFixtureName('s15-lesson'),
        orderIndex: 0,
        isPublished: true,
        videoUrl: 'https://youtu.be/fixture',
        notes: '## Theory\nfixture',
      },
    });
    const task = await prisma.lessonTask.create({
      data: {
        lessonId: lesson.id,
        type: 'QUIZ',
        title: testFixtureName('s15-quiz'),
        content: {},
        points: 10,
        orderIndex: 0,
        isPublished: true,
      },
    });
    return { courseId: course.id, lessonId: lesson.id, taskId: task.id };
  };

  // A course whose lessons have ONLY the 'video' stage (videoUrl set, no
  // notes, no quiz/practice task) — keeps deriveLessonStatus's available
  // stages to exactly one, so completion is a single LessonStepProgress row,
  // inserted directly rather than through the real video-progress endpoint.
  const createCourseWithVideoOnlyLessons = async (
    lessonCount: number,
  ): Promise<{ courseId: string; lessonIds: string[] }> => {
    const course = await prisma.course.create({
      data: {
        title: testFixtureName('s15-roadmap-course'),
        type: 'GRAMMAR',
        description: 'fixture course',
        isPublished: true,
      },
    });
    createdCourseIds.push(course.id);
    const lessonIds: string[] = [];
    for (let i = 0; i < lessonCount; i++) {
      const lesson = await prisma.lesson.create({
        data: {
          courseId: course.id,
          title: testFixtureName(`s15-roadmap-lesson-${i}`),
          orderIndex: i,
          isPublished: true,
          videoUrl: 'https://youtu.be/fixture',
          notes: null,
        },
      });
      lessonIds.push(lesson.id);
    }
    return { courseId: course.id, lessonIds };
  };

  const markVideoCompleted = (userId: string, lessonId: string) =>
    prisma.lessonStepProgress.create({
      data: {
        userId,
        lessonId,
        step: 'VIDEO',
        startedAt: new Date(),
        completedAt: new Date(),
      },
    });

  const createRoadmapForCourse = (userId: string, courseId: string) =>
    prisma.roadmap.create({
      data: {
        userId,
        goal: 'GENERAL_ENGLISH',
        items: [
          {
            phase: 1,
            pillar: 'GRAMMAR',
            resourceType: 'COURSE',
            resourceId: courseId,
            reason: 'fixture',
          },
        ],
      },
    });

  const createAttempt = (
    userId: string,
    taskId: string,
    accuracyPercent: number,
    passed: boolean,
  ) =>
    prisma.lessonTaskAttempt.create({
      data: {
        userId,
        taskId,
        correctCount: Math.round(accuracyPercent / 10),
        totalCount: 10,
        accuracyPercent,
        passed,
        result: {},
        clientAttemptId: randomUUID(),
      },
    });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication({ rawBody: true });
    app.useWebSocketAdapter(new WsAdapter(app));
    app.useGlobalPipes(new ValidationPipe());
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    if (createdCourseIds.length) {
      const where = { lesson: { courseId: { in: createdCourseIds } } };
      await prisma.lessonTaskAttempt.deleteMany({ where: { task: where } });
      await prisma.lessonTask.deleteMany({ where });
      await prisma.lessonStepProgress.deleteMany({
        where: { lesson: { courseId: { in: createdCourseIds } } },
      });
      await prisma.lesson.deleteMany({
        where: { courseId: { in: createdCourseIds } },
      });
      await prisma.course.deleteMany({
        where: { id: { in: createdCourseIds } },
      });
    }
    if (createdUserIds.length) {
      // Cascades to Subscription/Payment/Roadmap/SpeakingAttempt rows too.
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await app.close();
  });

  describe('non-admin access', () => {
    it('403s a regular USER on all three admin routes', async () => {
      const { token, userId } = await registerAndLogin('nonadmin');

      await request(app.getHttpServer())
        .get('/users/overview')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
      await request(app.getHttpServer())
        .get(`/users/${userId}/overview`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
      await request(app.getHttpServer())
        .patch(`/users/${userId}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ isActive: false })
        .expect(403);
    });
  });

  describe('GET /users/overview', () => {
    it('lists a student summary row with real, zero-error aggregation', async () => {
      const admin = await registerAndLogin('list-admin', 'ADMIN');
      const student = await registerAndLogin('list-student');

      const res = await request(app.getHttpServer())
        .get('/users/overview')
        .query({ search: student.email })
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200);

      const body = res.body as {
        data: Array<{
          id: string;
          progressPercent: number | null;
          averageTestScore: number | null;
          isPro: boolean;
          isActive: boolean;
        }>;
        meta: { total: number };
      };
      const row = body.data.find((r) => r.id === student.userId);
      expect(row).toBeDefined();
      // A brand-new student has no roadmap and no attempts yet — safe
      // null/zero values, not an error and not a fabricated number.
      expect(row!.progressPercent).toBeNull();
      expect(row!.averageTestScore).toBeNull();
      expect(row!.isPro).toBe(false);
      expect(row!.isActive).toBe(true);
    });

    it('filters by plan=PRO / plan=FREE using the same isPro derivation as the row itself', async () => {
      const admin = await registerAndLogin('plan-filter-admin', 'ADMIN');
      const proStudent = await registerAndLogin('plan-filter-pro');
      const freeStudent = await registerAndLogin('plan-filter-free');
      await prisma.subscription.create({
        data: {
          userId: proStudent.userId,
          plan: 'PRO_MONTHLY',
          startsAt: new Date(),
          expiresAt: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
          lastPaymentId: randomUUID(),
        },
      });

      const proRes = await request(app.getHttpServer())
        .get('/users/overview')
        .query({ search: 'plan-filter', plan: 'PRO', limit: 20 })
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200);
      const proIds = (proRes.body as { data: Array<{ id: string }> }).data.map(
        (r) => r.id,
      );
      expect(proIds).toContain(proStudent.userId);
      expect(proIds).not.toContain(freeStudent.userId);

      const freeRes = await request(app.getHttpServer())
        .get('/users/overview')
        .query({ search: 'plan-filter', plan: 'FREE', limit: 20 })
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200);
      const freeIds = (
        freeRes.body as { data: Array<{ id: string }> }
      ).data.map((r) => r.id);
      expect(freeIds).toContain(freeStudent.userId);
      expect(freeIds).not.toContain(proStudent.userId);
    });

    it('filters by status=ACTIVE / status=BLOCKED using the real User.isActive gate', async () => {
      const admin = await registerAndLogin('status-filter-admin', 'ADMIN');
      const activeStudent = await registerAndLogin('status-filter-active');
      const blockedStudent = await registerAndLogin('status-filter-blocked');
      await request(app.getHttpServer())
        .patch(`/users/${blockedStudent.userId}/status`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ isActive: false })
        .expect(200);

      const activeRes = await request(app.getHttpServer())
        .get('/users/overview')
        .query({ search: 'status-filter', status: 'ACTIVE', limit: 20 })
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200);
      const activeIds = (
        activeRes.body as { data: Array<{ id: string }> }
      ).data.map((r) => r.id);
      expect(activeIds).toContain(activeStudent.userId);
      expect(activeIds).not.toContain(blockedStudent.userId);

      const blockedRes = await request(app.getHttpServer())
        .get('/users/overview')
        .query({ search: 'status-filter', status: 'BLOCKED', limit: 20 })
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200);
      const blockedIds = (
        blockedRes.body as { data: Array<{ id: string }> }
      ).data.map((r) => r.id);
      expect(blockedIds).toContain(blockedStudent.userId);
      expect(blockedIds).not.toContain(activeStudent.userId);
    });
  });

  describe('GET /users/:id/overview', () => {
    it('returns safe zero/empty values for a student with no learning, test, speaking or payment data', async () => {
      const admin = await registerAndLogin('detail-admin', 'ADMIN');
      const student = await registerAndLogin('empty-student');

      const res = await request(app.getHttpServer())
        .get(`/users/${student.userId}/overview`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200);

      const body = res.body as {
        progress: {
          progressPercent: number | null;
          averageTestScore: number | null;
          recentTests: unknown[];
        };
        activity: {
          totalStudySeconds: number;
          currentStreakDays: number;
          speakingSessionsTotal: number;
        };
        billing: { plan: string | null; payments: unknown[] };
      };
      expect(body.progress.progressPercent).toBeNull();
      expect(body.progress.averageTestScore).toBeNull();
      expect(body.progress.recentTests).toEqual([]);
      expect(body.activity.totalStudySeconds).toBe(0);
      expect(body.activity.currentStreakDays).toBe(0);
      expect(body.activity.speakingSessionsTotal).toBe(0);
      expect(body.billing.plan).toBeNull();
      expect(body.billing.payments).toEqual([]);
    });

    it('computes averageTestScore from real LessonTaskAttempt rows (lifetime average, published QUIZ/PRACTICE only)', async () => {
      const admin = await registerAndLogin('score-admin', 'ADMIN');
      const student = await registerAndLogin('score-student');
      const { taskId } = await createPublishedTask();

      await createAttempt(student.userId, taskId, 80, true);
      await createAttempt(student.userId, taskId, 60, false);

      const res = await request(app.getHttpServer())
        .get(`/users/${student.userId}/overview`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200);

      const body = res.body as {
        progress: {
          averageTestScore: number | null;
          completedTestCount: number;
          recentTests: Array<{ passed: boolean }>;
        };
      };
      expect(body.progress.averageTestScore).toBe(70);
      expect(body.progress.completedTestCount).toBe(2);
      // passed comes straight from LessonTaskAttempt.passed — never an
      // invented threshold.
      expect(body.progress.recentTests.map((t) => t.passed).sort()).toEqual([
        false,
        true,
      ]);
    });

    it('progressPercent reproduces the exact roadmap-based arithmetic across 0%, partial (proving round, not floor) and 100%', async () => {
      const admin = await registerAndLogin('progress-admin', 'ADMIN');
      const student = await registerAndLogin('progress-student');
      const { courseId, lessonIds } = await createCourseWithVideoOnlyLessons(3);
      await createRoadmapForCourse(student.userId, courseId);

      const fetchProgress = async () => {
        const res = await request(app.getHttpServer())
          .get(`/users/${student.userId}/overview`)
          .set('Authorization', `Bearer ${admin.token}`)
          .expect(200);
        return (
          res.body as {
            progress: {
              progressPercent: number | null;
              completedLessons: number;
              totalLessons: number;
              hasRoadmap: boolean;
            };
          }
        ).progress;
      };

      // 0 of 3 complete.
      let progress = await fetchProgress();
      expect(progress).toMatchObject({
        progressPercent: 0,
        completedLessons: 0,
        totalLessons: 3,
        hasRoadmap: true,
      });

      // 2 of 3 complete -> 66.67%. deriveCourseSummary's OWN per-course
      // figure floors to 66; the admin aggregate sums raw counts and rounds
      // (matching UserHome.tsx's client formula, not the per-course one) ->
      // 67. This assertion is what actually proves which formula ran.
      await markVideoCompleted(student.userId, lessonIds[0]);
      await markVideoCompleted(student.userId, lessonIds[1]);
      progress = await fetchProgress();
      expect(progress).toMatchObject({
        progressPercent: 67,
        completedLessons: 2,
        totalLessons: 3,
      });

      // 3 of 3 complete -> 100%.
      await markVideoCompleted(student.userId, lessonIds[2]);
      progress = await fetchProgress();
      expect(progress).toMatchObject({
        progressPercent: 100,
        completedLessons: 3,
        totalLessons: 3,
      });
    });

    it('a roadmap whose course has zero published lessons yields null, not a divide-by-zero 0 or NaN', async () => {
      const admin = await registerAndLogin('empty-course-admin', 'ADMIN');
      const student = await registerAndLogin('empty-course-student');
      const { courseId } = await createCourseWithVideoOnlyLessons(0);
      await createRoadmapForCourse(student.userId, courseId);

      const res = await request(app.getHttpServer())
        .get(`/users/${student.userId}/overview`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200);

      const body = res.body as {
        progress: {
          progressPercent: number | null;
          totalLessons: number;
          hasRoadmap: boolean;
        };
      };
      expect(body.progress.progressPercent).toBeNull();
      expect(body.progress.totalLessons).toBe(0);
      expect(body.progress.hasRoadmap).toBe(true);
    });

    it('PRO derives true while Subscription.expiresAt is in the future', async () => {
      const admin = await registerAndLogin('pro-admin', 'ADMIN');
      const student = await registerAndLogin('pro-student');
      const future = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
      await prisma.subscription.create({
        data: {
          userId: student.userId,
          plan: 'PRO_MONTHLY',
          startsAt: new Date(),
          expiresAt: future,
          lastPaymentId: randomUUID(),
        },
      });

      const res = await request(app.getHttpServer())
        .get(`/users/${student.userId}/overview`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200);

      const body = res.body as {
        profile: { isPro: boolean };
        billing: { isPro: boolean; plan: string };
      };
      expect(body.profile.isPro).toBe(true);
      expect(body.billing.isPro).toBe(true);
      expect(body.billing.plan).toBe('PRO_MONTHLY');
    });

    it('displays Free (isPro=false) once Subscription.expiresAt has passed, even though the row still exists', async () => {
      const admin = await registerAndLogin('expired-admin', 'ADMIN');
      const student = await registerAndLogin('expired-student');
      const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
      await prisma.subscription.create({
        data: {
          userId: student.userId,
          plan: 'PRO_MONTHLY',
          startsAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
          expiresAt: past,
          lastPaymentId: randomUUID(),
        },
      });

      const res = await request(app.getHttpServer())
        .get(`/users/${student.userId}/overview`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200);

      const body = res.body as { profile: { isPro: boolean } };
      expect(body.profile.isPro).toBe(false);
    });

    it('only returns payment history belonging to the requested student, never another user’s', async () => {
      const admin = await registerAndLogin('pay-admin', 'ADMIN');
      const studentA = await registerAndLogin('pay-student-a');
      const studentB = await registerAndLogin('pay-student-b');

      await prisma.payment.create({
        data: {
          userId: studentA.userId,
          plan: 'PRO_MONTHLY',
          amount: 199000,
          paymentCode: `ENGPAYA${randomUUID().slice(0, 6).toUpperCase()}`,
          status: 'PAID',
          expiresAt: new Date(Date.now() + 60_000),
          paidAt: new Date(),
        },
      });
      await prisma.payment.create({
        data: {
          userId: studentB.userId,
          plan: 'PRO_MONTHLY',
          amount: 199000,
          paymentCode: `ENGPAYB${randomUUID().slice(0, 6).toUpperCase()}`,
          status: 'PAID',
          expiresAt: new Date(Date.now() + 60_000),
          paidAt: new Date(),
        },
      });

      const res = await request(app.getHttpServer())
        .get(`/users/${studentA.userId}/overview`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200);

      const body = res.body as {
        billing: { payments: Array<{ paymentCode: string }> };
      };
      expect(body.billing.payments).toHaveLength(1);
      expect(body.billing.payments[0].paymentCode).toContain('ENGPAYA');
    });
  });

  describe('PATCH /users/:id/status — block / unblock', () => {
    it('blocks then unblocks a student, and an admin cannot block their own account', async () => {
      const admin = await registerAndLogin('block-admin', 'ADMIN');
      const student = await registerAndLogin('block-student');

      await request(app.getHttpServer())
        .patch(`/users/${admin.userId}/status`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ isActive: false })
        .expect(403);

      const blockRes = await request(app.getHttpServer())
        .patch(`/users/${student.userId}/status`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ isActive: false })
        .expect(200);
      expect((blockRes.body as { isActive: boolean }).isActive).toBe(false);

      const blocked = await prisma.user.findUniqueOrThrow({
        where: { id: student.userId },
      });
      expect(blocked.isActive).toBe(false);

      const unblockRes = await request(app.getHttpServer())
        .patch(`/users/${student.userId}/status`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ isActive: true })
        .expect(200);
      expect((unblockRes.body as { isActive: boolean }).isActive).toBe(true);
    });
  });

  describe('Blocking affects authentication', () => {
    it('a blocked student cannot log in, and unblocking restores login', async () => {
      const admin = await registerAndLogin('auth-admin', 'ADMIN');
      const student = await registerAndLogin('auth-student');

      await request(app.getHttpServer())
        .patch(`/users/${student.userId}/status`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ isActive: false })
        .expect(200);

      const blockedLogin = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: student.email, password: 'password123', role: 'USER' })
        .expect(403);
      expect((blockedLogin.body as { message: string }).message).toContain(
        'đã bị khóa',
      );

      await request(app.getHttpServer())
        .patch(`/users/${student.userId}/status`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ isActive: true })
        .expect(200);

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: student.email, password: 'password123', role: 'USER' })
        .expect(201);
    });

    it('blocking a logged-in student revokes their refresh session so refresh fails', async () => {
      const admin = await registerAndLogin('refresh-admin', 'ADMIN');
      const student = await registerAndLogin('refresh-student');

      const loginRes = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: student.email, password: 'password123', role: 'USER' })
        .expect(201);
      const setCookie = loginRes.headers['set-cookie'] as unknown as string[];
      // REFRESH_COOKIE_NAME (refresh-token.constants.ts) — 'emai_rt'.
      const refreshCookie = setCookie.find((c) => c.startsWith('emai_rt='));
      expect(refreshCookie).toBeDefined();

      await request(app.getHttpServer())
        .patch(`/users/${student.userId}/status`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ isActive: false })
        .expect(200);

      await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Origin', TRUSTED_ORIGIN)
        .set('Cookie', [refreshCookie!])
        .expect(401);
    });
  });
});
