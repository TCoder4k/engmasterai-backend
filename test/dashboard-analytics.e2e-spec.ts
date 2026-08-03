import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { testFixtureName } from './test-database.util';

// Sprint 09 — GET /analytics/dashboard.
//
// What this suite is here to prove, against a real database rather than a mock:
//   - real study activity actually reaches the numbers (the unit spec proves
//     the arithmetic; this proves the wiring and the Prisma filters);
//   - an unpublished lesson leaves the completion counts but KEEPS its day on
//     the activity calendar — the deliberate asymmetry, which is the one
//     decision in this sprint most likely to be "tidied" into a bug later;
//   - a bad `tz` is a 400, not a 500 (it reaches Intl.DateTimeFormat, which
//     throws RangeError on an unknown zone);
//   - the 'stats' rate-limit bucket is genuinely separate from 'read', so
//     hammering the dashboard cannot throttle course progress;
//   - one student never sees another's activity.
describe('Dashboard analytics (e2e) — Sprint 09', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const createdUserEmails: string[] = [];
  const createdCourseIds: string[] = [];

  const registerAndLogin = async (
    label: string,
  ): Promise<{ token: string; userId: string }> => {
    const email = `s09-${label.slice(0, 18)}-${randomUUID()}@example.test`;
    createdUserEmails.push(email);
    const register = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: `Sprint 09 ${label}`, email, password: 'password123' });
    const userId = (register.body as { user: { id: string } }).user.id;
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'password123', role: 'USER' });
    return {
      token: (login.body as { accessToken: string }).accessToken,
      userId,
    };
  };

  const createCourse = async (isPublished = true): Promise<string> => {
    const course = await prisma.course.create({
      data: {
        title: testFixtureName('s09-course'),
        type: 'GRAMMAR',
        description: 'fixture course',
        isPublished,
      },
    });
    createdCourseIds.push(course.id);
    return course.id;
  };

  const createLesson = async (
    courseId: string,
    orderIndex: number,
    isPublished = true,
  ): Promise<string> => {
    const lesson = await prisma.lesson.create({
      data: {
        courseId,
        title: testFixtureName(`s09-lesson-${orderIndex}`),
        orderIndex,
        isPublished,
        videoUrl: 'https://youtu.be/fixture',
        notes: '## Theory\nSome content.',
      },
    });
    return lesson.id;
  };

  const getDashboard = (token: string, tz?: string) =>
    request(app.getHttpServer())
      .get('/analytics/dashboard')
      .query(tz ? { tz } : {})
      .set('Authorization', `Bearer ${token}`);

  const completeTheory = (lessonId: string, token: string) =>
    request(app.getHttpServer())
      .post(`/lessons/${lessonId}/steps/theory/complete`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

  const completeVideo = (lessonId: string, token: string) =>
    request(app.getHttpServer())
      .post(`/lessons/${lessonId}/steps/video/progress`)
      .set('Authorization', `Bearer ${token}`)
      .send({ positionSeconds: 600, durationSeconds: 600 })
      .expect(201);

  interface DashboardBody {
    effectiveTimeZone: string;
    today: {
      date: string;
      stagesCompleted: number;
      taskAttempts: { quiz: number; practice: number; total: number };
      newWordsLearned: number;
      wordsReviewed: number;
      activeStudySeconds: number;
    };
    activity: {
      windowDays: number;
      days: { date: string; active: boolean }[];
      currentStreakDays: number;
      streakCapped: boolean;
    };
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    const where = { lesson: { courseId: { in: createdCourseIds } } };
    await prisma.lessonStepProgress.deleteMany({ where });
    await prisma.lessonTaskProgress.deleteMany({ where: { task: where } });
    await prisma.lessonTaskAttempt.deleteMany({ where: { task: where } });
    await prisma.question.deleteMany({ where: { task: where } });
    await prisma.lessonTask.deleteMany({ where });
    await prisma.lesson.deleteMany({
      where: { courseId: { in: createdCourseIds } },
    });
    await prisma.course.deleteMany({ where: { id: { in: createdCourseIds } } });
    if (createdUserEmails.length) {
      await prisma.user.deleteMany({
        where: { email: { in: createdUserEmails } },
      });
    }
    await app.close();
  });

  describe('authentication and validation', () => {
    it('rejects an unauthenticated request', async () => {
      await request(app.getHttpServer())
        .get('/analytics/dashboard')
        .expect(401);
    });

    // The reason DashboardAnalyticsQueryDto carries @IsTimeZone(). Without it
    // this value reaches Intl.DateTimeFormat and becomes a 500.
    it('rejects an unknown timezone with 400, not 500', async () => {
      const { token } = await registerAndLogin('badtz');

      await getDashboard(token, 'Not/AZone').expect(400);
    });

    it('rejects a non-timezone string with 400', async () => {
      const { token } = await registerAndLogin('badtz2');

      await getDashboard(token, '"; DROP TABLE users; --').expect(400);
    });

    it('accepts a request with no tz at all', async () => {
      const { token } = await registerAndLogin('notz');

      const res = await getDashboard(token).expect(200);

      expect((res.body as DashboardBody).effectiveTimeZone).toBe('UTC');
    });

    // Sprint 10.5 — the Daily Goal numerator joins this payload. A brand-new
    // account must report a real 0, never null: `null` is the client's ERROR
    // state, and Postgres SUM over an empty set is exactly that.
    it('reports 0 active study seconds for a brand-new account', async () => {
      const { token } = await registerAndLogin('nostudy');

      const res = await getDashboard(token, 'Asia/Ho_Chi_Minh').expect(200);

      expect((res.body as DashboardBody).today.activeStudySeconds).toBe(0);
    });
  });

  describe('shape', () => {
    it('returns a seven-day ascending window ending today', async () => {
      const { token } = await registerAndLogin('shape');

      const res = await getDashboard(token, 'Asia/Ho_Chi_Minh').expect(200);
      const body = res.body as DashboardBody;

      expect(body.effectiveTimeZone).toBe('Asia/Ho_Chi_Minh');
      expect(body.activity.windowDays).toBe(7);
      expect(body.activity.days).toHaveLength(7);
      expect(body.activity.days.at(-1)?.date).toBe(body.today.date);

      const dates = body.activity.days.map((day) => day.date);
      expect([...dates].sort()).toEqual(dates);
    });

    it('reports honest zeros for a brand-new account', async () => {
      const { token } = await registerAndLogin('fresh');

      const res = await getDashboard(token, 'Asia/Ho_Chi_Minh').expect(200);
      const body = res.body as DashboardBody;

      expect(body.today.stagesCompleted).toBe(0);
      expect(body.today.taskAttempts).toEqual({
        quiz: 0,
        practice: 0,
        total: 0,
      });
      expect(body.today.newWordsLearned).toBe(0);
      expect(body.today.wordsReviewed).toBe(0);
      expect(body.activity.currentStreakDays).toBe(0);
      expect(body.activity.streakCapped).toBe(false);
    });
  });

  describe('real activity reaches the numbers', () => {
    it('counts a completed theory step and lights up today', async () => {
      const { token } = await registerAndLogin('theory');
      const courseId = await createCourse();
      const lessonId = await createLesson(courseId, 0);

      await completeTheory(lessonId, token);

      const res = await getDashboard(token, 'Asia/Ho_Chi_Minh').expect(200);
      const body = res.body as DashboardBody;

      expect(body.today.stagesCompleted).toBe(1);
      expect(body.activity.days.at(-1)?.active).toBe(true);
      expect(body.activity.currentStreakDays).toBe(1);
    });

    it('counts video and theory as two separate stages', async () => {
      const { token } = await registerAndLogin('twostage');
      const courseId = await createCourse();
      const lessonId = await createLesson(courseId, 0);

      await completeVideo(lessonId, token);
      await completeTheory(lessonId, token);

      const res = await getDashboard(token, 'Asia/Ho_Chi_Minh').expect(200);

      expect((res.body as DashboardBody).today.stagesCompleted).toBe(2);
    });

    // Guards against a double-count via the idempotent step endpoints: theory
    // completion is stamped once and never restamped, so re-posting must not
    // move the number.
    it('does not double-count a repeated theory completion', async () => {
      const { token } = await registerAndLogin('idem');
      const courseId = await createCourse();
      const lessonId = await createLesson(courseId, 0);

      await completeTheory(lessonId, token);
      await completeTheory(lessonId, token);
      await completeTheory(lessonId, token);

      const res = await getDashboard(token, 'Asia/Ho_Chi_Minh').expect(200);

      expect((res.body as DashboardBody).today.stagesCompleted).toBe(1);
    });
  });

  // THE ASYMMETRY. If someone later "fixes" the activity window to filter on
  // publication for consistency, this test is what stops them.
  describe('unpublished content', () => {
    it('leaves the completion count but keeps the activity day', async () => {
      const { token } = await registerAndLogin('unpub');
      const courseId = await createCourse();
      const lessonId = await createLesson(courseId, 0);

      await completeTheory(lessonId, token);

      const before = await getDashboard(token, 'Asia/Ho_Chi_Minh').expect(200);
      expect((before.body as DashboardBody).today.stagesCompleted).toBe(1);

      await prisma.lesson.update({
        where: { id: lessonId },
        data: { isPublished: false },
      });

      const after = await getDashboard(token, 'Asia/Ho_Chi_Minh').expect(200);
      const body = after.body as DashboardBody;

      // Completion follows the course pages, which cannot see a draft lesson.
      expect(body.today.stagesCompleted).toBe(0);
      // The student still studied that day. An admin's edit must not rewrite
      // their history.
      expect(body.activity.days.at(-1)?.active).toBe(true);
      expect(body.activity.currentStreakDays).toBe(1);
    });

    it('also drops completions when the COURSE is unpublished', async () => {
      const { token } = await registerAndLogin('unpubcourse');
      const courseId = await createCourse();
      const lessonId = await createLesson(courseId, 0);

      await completeTheory(lessonId, token);
      await prisma.course.update({
        where: { id: courseId },
        data: { isPublished: false },
      });

      const res = await getDashboard(token, 'Asia/Ho_Chi_Minh').expect(200);
      const body = res.body as DashboardBody;

      expect(body.today.stagesCompleted).toBe(0);
      expect(body.activity.days.at(-1)?.active).toBe(true);
    });
  });

  describe('timezone handling', () => {
    it('bootstraps User.timezone when it is null, without overwriting later', async () => {
      const { token, userId } = await registerAndLogin('tzboot');

      const before = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { timezone: true },
      });
      expect(before.timezone).toBeNull();

      await getDashboard(token, 'Asia/Ho_Chi_Minh').expect(200);

      const after = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { timezone: true },
      });
      expect(after.timezone).toBe('Asia/Ho_Chi_Minh');

      // A second, different zone must NOT move the stored value — the SRS
      // quota depends on that column being set once.
      await getDashboard(token, 'America/New_York').expect(200);

      const final = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { timezone: true },
      });
      expect(final.timezone).toBe('Asia/Ho_Chi_Minh');
    });

    // The read precedence that differs from LearningService, on purpose.
    it('lets the request timezone win over the stored one for the READ', async () => {
      const { token } = await registerAndLogin('tzwin');

      await getDashboard(token, 'Asia/Ho_Chi_Minh').expect(200);

      const res = await getDashboard(token, 'America/New_York').expect(200);

      expect((res.body as DashboardBody).effectiveTimeZone).toBe(
        'America/New_York',
      );
    });
  });

  describe('isolation', () => {
    it("never leaks one student's activity into another's dashboard", async () => {
      const alice = await registerAndLogin('alice');
      const bob = await registerAndLogin('bob');
      const courseId = await createCourse();
      const lessonId = await createLesson(courseId, 0);

      await completeTheory(lessonId, alice.token);

      const aliceRes = await getDashboard(
        alice.token,
        'Asia/Ho_Chi_Minh',
      ).expect(200);
      const bobRes = await getDashboard(bob.token, 'Asia/Ho_Chi_Minh').expect(
        200,
      );

      expect((aliceRes.body as DashboardBody).today.stagesCompleted).toBe(1);
      expect((bobRes.body as DashboardBody).today.stagesCompleted).toBe(0);
      expect((bobRes.body as DashboardBody).activity.currentStreakDays).toBe(0);
    });
  });

  // The kind IS the bucket (`quiz:${kind}:${userId}`). This is what proves
  // 'stats' did not silently end up sharing 'read' with GET /progress/courses,
  // whose symptom would be "course progress randomly stops loading".
  describe('rate-limit bucket isolation', () => {
    it('exhausting the stats bucket leaves course progress usable', async () => {
      const { token } = await registerAndLogin('ratelimit');
      const courseId = await createCourse();
      await createLesson(courseId, 0);

      // Policy is 30 per 60s; go well past it.
      let sawThrottle = false;
      for (let i = 0; i < 40; i += 1) {
        const res = await getDashboard(token, 'Asia/Ho_Chi_Minh');
        if (res.status === 429) {
          sawThrottle = true;
          break;
        }
      }
      expect(sawThrottle).toBe(true);

      // A different bucket entirely — must still serve.
      await request(app.getHttpServer())
        .get('/progress/courses')
        .query({ courseIds: courseId })
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });
  });
});
