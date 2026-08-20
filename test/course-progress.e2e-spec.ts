import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WsAdapter } from '@nestjs/platform-ws';
import request from 'supertest';
import type { App } from 'supertest/types';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { testFixtureName } from './test-database.util';

// Sprint 08 — GET /progress/courses, the canonical course aggregate.
//
// What this suite is here to prove:
//   - lesson and course status are DERIVED ON THE SERVER and identical across
//     independent sessions, so a percentage cannot depend on the browser;
//   - a lesson with no completable stage (published with audio only) is
//     excluded from the totals, so its course can still reach 100%;
//   - the continuation target follows orderIndex, not recency;
//   - unpublished lessons and unpublished courses are invisible;
//   - one user can never read another's progress, even by asking for their
//     course ids;
//   - a single stale course id does not fail the whole batch.
describe('Course progress (e2e) — Sprint 08', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const createdUserEmails: string[] = [];
  const createdCourseIds: string[] = [];

  const registerAndLogin = async (
    label: string,
  ): Promise<{ token: string; userId: string; email: string }> => {
    const email = `s08-${label.slice(0, 18)}-${randomUUID()}@example.test`;
    createdUserEmails.push(email);
    const register = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: `Sprint 08 ${label}`, email, password: 'password123' });
    const userId = (register.body as { user: { id: string } }).user.id;
    return { token: await login(email), userId, email };
  };

  // Separate, so a test can get a SECOND independent token for one account —
  // this suite's expression of "the same student in another browser".
  const login = async (email: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'password123', role: 'USER' });
    return (res.body as { accessToken: string }).accessToken;
  };

  const createCourse = async (
    title: string,
    isPublished = true,
  ): Promise<string> => {
    const course = await prisma.course.create({
      data: {
        title: testFixtureName(title),
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
    opts: {
      video?: boolean;
      notes?: boolean;
      audioOnly?: boolean;
      isPublished?: boolean;
    } = {},
  ): Promise<string> => {
    const lesson = await prisma.lesson.create({
      data: {
        courseId,
        title: testFixtureName(`lesson-${orderIndex}`),
        orderIndex,
        isPublished: opts.isPublished ?? true,
        // audioOnly reproduces the real publishable shape that has no
        // completable stage at all: LessonService.publish accepts audio with
        // no video, and no audio stage exists.
        videoUrl:
          opts.audioOnly || opts.video === false
            ? null
            : 'https://youtu.be/fixture',
        audioUrl: opts.audioOnly ? 'https://cdn.test/audio.mp3' : null,
        notes:
          opts.audioOnly || opts.notes === false
            ? null
            : '## Theory\nSome content.',
      },
    });
    return lesson.id;
  };

  const getProgress = (
    courseIds: string[],
    token: string,
    include?: 'lessons',
  ) =>
    request(app.getHttpServer())
      .get('/progress/courses')
      .query({
        courseIds: courseIds.join(','),
        ...(include ? { include } : {}),
      })
      .set('Authorization', `Bearer ${token}`);

  const completeVideo = (lessonId: string, token: string) =>
    request(app.getHttpServer())
      .post(`/lessons/${lessonId}/steps/video/progress`)
      .set('Authorization', `Bearer ${token}`)
      .send({ positionSeconds: 600, durationSeconds: 600 })
      .expect(201);

  const completeTheory = (lessonId: string, token: string) =>
    request(app.getHttpServer())
      .post(`/lessons/${lessonId}/steps/theory/complete`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

  // A lesson here offers video + theory, so both must finish for COMPLETED.
  const completeLesson = async (lessonId: string, token: string) => {
    await completeVideo(lessonId, token);
    await completeTheory(lessonId, token);
  };

  interface Summary {
    courseId: string;
    totalLessons: number;
    completedLessons: number;
    inProgressLessons: number;
    notStartedLessons: number;
    progressPercent: number;
    status: string;
    continueLessonId: string | null;
    lessons: { lessonId: string; orderIndex: number; status: string }[] | null;
  }

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
    // No admin fixture here, deliberately: every lesson this suite needs is
    // created straight through Prisma, because the shapes under test include
    // ones the admin API will not produce — an audio-only lesson, and a draft
    // lesson sitting inside a published course.
  });

  afterAll(async () => {
    const where = { lesson: { courseId: { in: createdCourseIds } } };
    await prisma.lessonStepProgress.deleteMany({ where });
    await prisma.lessonTaskProgress.deleteMany({ where: { task: where } });
    // Before lessonTask: LessonTaskAttempt.task is Restrict, not Cascade.
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

  // --- The three states a course can be in ---------------------------------

  describe('course status', () => {
    it('reports every lesson NOT_STARTED and points at the first one', async () => {
      const courseId = await createCourse('untouched');
      const first = await createLesson(courseId, 0);
      await createLesson(courseId, 1);
      const { token } = await registerAndLogin('untouched');

      const res = await getProgress([courseId], token, 'lessons').expect(200);
      const [summary] = res.body as Summary[];

      expect(summary).toMatchObject({
        courseId,
        totalLessons: 2,
        completedLessons: 0,
        notStartedLessons: 2,
        progressPercent: 0,
        status: 'NOT_STARTED',
        continueLessonId: first,
      });
      expect(summary.lessons?.every((l) => l.status === 'NOT_STARTED')).toBe(
        true,
      );
    });

    it('is IN_PROGRESS at 0% when a lesson is started but nothing is finished', async () => {
      // The case a percent-driven CTA gets wrong: the student has a place to
      // return to, so the button must say "Học tiếp", not "Bắt đầu".
      const courseId = await createCourse('started');
      const first = await createLesson(courseId, 0);
      await createLesson(courseId, 1);
      const { token } = await registerAndLogin('started');

      await completeVideo(first, token); // theory still outstanding

      const [summary] = (await getProgress([courseId], token).expect(200))
        .body as Summary[];

      expect(summary).toMatchObject({
        completedLessons: 0,
        inProgressLessons: 1,
        progressPercent: 0,
        status: 'IN_PROGRESS',
        continueLessonId: first,
      });
    });

    it('advances the percentage and the continuation target as lessons finish', async () => {
      const courseId = await createCourse('advancing');
      const first = await createLesson(courseId, 0);
      const second = await createLesson(courseId, 1);
      const { token } = await registerAndLogin('advancing');

      await completeLesson(first, token);

      const [summary] = (await getProgress([courseId], token).expect(200))
        .body as Summary[];

      expect(summary).toMatchObject({
        completedLessons: 1,
        progressPercent: 50,
        status: 'IN_PROGRESS',
        continueLessonId: second,
      });
    });

    it('reports COMPLETED and points back at the first lesson for review', async () => {
      const courseId = await createCourse('finished');
      const first = await createLesson(courseId, 0);
      const second = await createLesson(courseId, 1);
      const { token } = await registerAndLogin('finished');

      await completeLesson(first, token);
      await completeLesson(second, token);

      const [summary] = (await getProgress([courseId], token).expect(200))
        .body as Summary[];

      expect(summary).toMatchObject({
        completedLessons: 2,
        progressPercent: 100,
        status: 'COMPLETED',
        continueLessonId: first,
      });
    });

    it('reports 0/0 for a course with no published lessons', async () => {
      const courseId = await createCourse('empty');
      const { token } = await registerAndLogin('empty');

      const [summary] = (
        await getProgress([courseId], token, 'lessons').expect(200)
      ).body as Summary[];

      // A real state, not an error: the client renders 0/0 rather than
      // treating the course as missing.
      expect(summary).toMatchObject({
        totalLessons: 0,
        progressPercent: 0,
        status: 'NOT_STARTED',
        continueLessonId: null,
      });
      expect(summary.lessons).toEqual([]);
    });
  });

  // --- The H-4 case, end to end --------------------------------------------

  it('excludes an audio-only lesson so its course can still reach 100%', async () => {
    const courseId = await createCourse('audio');
    const real = await createLesson(courseId, 0);
    const audio = await createLesson(courseId, 1, { audioOnly: true });
    const { token } = await registerAndLogin('audio');

    await completeLesson(real, token);

    const [summary] = (
      await getProgress([courseId], token, 'lessons').expect(200)
    ).body as Summary[];

    // Without NO_CONTENT this course would sit at 50% forever, because the
    // audio lesson offers nothing the student can complete.
    expect(summary).toMatchObject({
      totalLessons: 1,
      completedLessons: 1,
      progressPercent: 100,
      status: 'COMPLETED',
    });
    // Still reported, so the row renders honestly rather than as "not started".
    expect(summary.lessons?.find((l) => l.lessonId === audio)?.status).toBe(
      'NO_CONTENT',
    );
    expect(summary.lessons?.find((l) => l.lessonId === real)?.status).toBe(
      'COMPLETED',
    );
  });

  // --- Visibility ----------------------------------------------------------

  describe('visibility', () => {
    it('ignores unpublished lessons in both numerator and denominator', async () => {
      const courseId = await createCourse('drafts');
      const published = await createLesson(courseId, 0);
      await createLesson(courseId, 1, { isPublished: false });
      const { token } = await registerAndLogin('drafts');

      await completeLesson(published, token);

      const [summary] = (
        await getProgress([courseId], token, 'lessons').expect(200)
      ).body as Summary[];

      expect(summary.totalLessons).toBe(1);
      expect(summary.progressPercent).toBe(100);
      expect(summary.lessons).toHaveLength(1);
    });

    it('omits an unpublished course instead of failing the batch', async () => {
      const visible = await createCourse('visible');
      const hidden = await createCourse('hidden', false);
      await createLesson(visible, 0);
      const { token } = await registerAndLogin('mixed');

      const res = await getProgress([visible, hidden], token).expect(200);
      const summaries = res.body as Summary[];

      expect(summaries).toHaveLength(1);
      expect(summaries[0].courseId).toBe(visible);
    });

    it('omits an unknown id instead of 404ing the whole request', async () => {
      // One stale id on a catalog page must not blank every other card.
      const courseId = await createCourse('stale');
      await createLesson(courseId, 0);
      const { token } = await registerAndLogin('stale');

      const res = await getProgress([courseId, randomUUID()], token).expect(
        200,
      );
      expect(res.body as Summary[]).toHaveLength(1);
    });
  });

  // --- Authorisation -------------------------------------------------------

  describe('authorisation', () => {
    it('rejects an unauthenticated request', async () => {
      const courseId = await createCourse('anon');
      await request(app.getHttpServer())
        .get('/progress/courses')
        .query({ courseIds: courseId })
        .expect(401);
    });

    it('never returns one student progress belonging to another', async () => {
      const courseId = await createCourse('isolation');
      const lessonId = await createLesson(courseId, 0);
      const alice = await registerAndLogin('alice');
      const bob = await registerAndLogin('bob');

      await completeLesson(lessonId, alice.token);

      const [forAlice] = (
        await getProgress([courseId], alice.token).expect(200)
      ).body as Summary[];
      const [forBob] = (await getProgress([courseId], bob.token).expect(200))
        .body as Summary[];

      expect(forAlice.progressPercent).toBe(100);
      // Bob asked for exactly the same course id and gets his own zeroes.
      expect(forBob.progressPercent).toBe(0);
      expect(forBob.status).toBe('NOT_STARTED');
    });
  });

  // --- Determinism ---------------------------------------------------------

  describe('determinism', () => {
    it('returns identical bodies to a refetch and to a second session', async () => {
      const courseId = await createCourse('sessions');
      const first = await createLesson(courseId, 0);
      await createLesson(courseId, 1);
      const { token, email } = await registerAndLogin('sessions');

      await completeLesson(first, token);

      const initial = (
        await getProgress([courseId], token, 'lessons').expect(200)
      ).body as Summary[];
      const refetch = (
        await getProgress([courseId], token, 'lessons').expect(200)
      ).body as Summary[];

      // A completely independent login — the "other browser" case.
      const secondSession = await login(email);
      const elsewhere = (
        await getProgress([courseId], secondSession, 'lessons').expect(200)
      ).body as Summary[];

      expect(refetch).toEqual(initial);
      expect(elsewhere).toEqual(initial);
    });

    it('reads the same completion the lesson aggregate reports', async () => {
      // The Sprint 07 bug in its course-level form: the lesson page and the
      // course page must never disagree about the same lesson.
      const courseId = await createCourse('agreement');
      const lessonId = await createLesson(courseId, 0);
      const { token } = await registerAndLogin('agreement');

      await completeVideo(lessonId, token);

      const lessonRes = await request(app.getHttpServer())
        .get(`/lessons/${lessonId}/progress`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const [summary] = (
        await getProgress([courseId], token, 'lessons').expect(200)
      ).body as Summary[];

      const steps = (
        lessonRes.body as { steps: { video: { completedAt: string | null } } }
      ).steps;
      expect(steps.video.completedAt).not.toBeNull();
      // Video done, theory outstanding — both surfaces say "in progress".
      expect(summary.lessons?.[0].status).toBe('IN_PROGRESS');
    });
  });

  // --- Contract ------------------------------------------------------------

  describe('query contract', () => {
    it('omits the lessons array unless include=lessons is requested', async () => {
      const courseId = await createCourse('include');
      await createLesson(courseId, 0);
      const { token } = await registerAndLogin('include');

      const without = (await getProgress([courseId], token).expect(200))
        .body as Summary[];
      const with_ = (
        await getProgress([courseId], token, 'lessons').expect(200)
      ).body as Summary[];

      expect(without[0].lessons).toBeNull();
      expect(with_[0].lessons).toHaveLength(1);
      // The counts do not depend on the flag.
      expect(without[0].totalLessons).toBe(with_[0].totalLessons);
    });

    it('rejects an empty courseIds list', async () => {
      const { token } = await registerAndLogin('empty-ids');
      await request(app.getHttpServer())
        .get('/progress/courses')
        .query({ courseIds: '' })
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });

    it('rejects more than twenty course ids', async () => {
      // The cap is what bounds the one cost in this endpoint that scales with
      // content: every lesson's notes are loaded to evaluate theory.
      const { token } = await registerAndLogin('too-many');
      const ids = Array.from({ length: 21 }, () => randomUUID()).join(',');
      await request(app.getHttpServer())
        .get('/progress/courses')
        .query({ courseIds: ids })
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });

    it('rejects a non-uuid course id', async () => {
      const { token } = await registerAndLogin('bad-id');
      await request(app.getHttpServer())
        .get('/progress/courses')
        .query({ courseIds: 'not-a-uuid' })
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });
  });

  // --- The H-3 companion ---------------------------------------------------

  it('serves total study time from the course endpoint, not a lessons fetch', async () => {
    // This is what lets the grammar roadmap stop fetching every lesson of
    // every course just to add up durations.
    const courseId = await createCourse('minutes');
    await prisma.lesson.create({
      data: {
        courseId,
        title: testFixtureName('m1'),
        orderIndex: 0,
        isPublished: true,
        videoUrl: 'https://youtu.be/fixture',
        estimatedStudyMinutes: 20,
      },
    });
    await prisma.lesson.create({
      data: {
        courseId,
        title: testFixtureName('m2'),
        orderIndex: 1,
        isPublished: true,
        videoUrl: 'https://youtu.be/fixture',
        estimatedStudyMinutes: 25,
      },
    });
    // A draft must not inflate the figure.
    await prisma.lesson.create({
      data: {
        courseId,
        title: testFixtureName('m3-draft'),
        orderIndex: 2,
        isPublished: false,
        videoUrl: 'https://youtu.be/fixture',
        estimatedStudyMinutes: 999,
      },
    });

    const res = await request(app.getHttpServer())
      .get(`/courses/${courseId}`)
      .expect(200);

    expect(
      (res.body as { totalEstimatedMinutes: number }).totalEstimatedMinutes,
    ).toBe(45);
  });
});
