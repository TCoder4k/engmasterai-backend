import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { expectIdempotentReplay } from './replay-assertions';
import { testFixtureName } from './test-database.util';

// Sprint 07 — durable learning progress. This suite is the proof for the
// sprint's hard invariants:
//
//   - video and theory survive a refresh, a re-login and a second session,
//     because they are server state rather than localStorage;
//   - a completed step NEVER regresses through ordinary review;
//   - GET /lessons/:id/quiz writes nothing, so opening a finished quiz cannot
//     silently begin a new attempt;
//   - a replayed submit REPLAYS under IMMEDIATE feedback instead of 400ing,
//     and a replay from two attempts ago hits the history backstop rather than
//     surfacing a raw P2002;
//   - retrying preserves every prior attempt;
//   - video traffic cannot exhaust the quiz-answering rate-limit budget.
describe('Lesson step progress (e2e) — Sprint 07', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const createdUserEmails: string[] = [];
  let courseId: string;
  let adminToken: string;

  const VIDEO_DURATION = 600;

  const registerAndLogin = async (
    label: string,
  ): Promise<{ token: string; userId: string; email: string }> => {
    // RFC 5321 caps the local part at 64 chars and class-validator enforces
    // it, so a long label produces a confusing 400 from /auth/register rather
    // than anything to do with the feature under test. A uuid is 36 chars.
    const email = `s07-${label.slice(0, 18)}-${randomUUID()}@example.test`;
    createdUserEmails.push(email);
    const register = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: `Sprint 07 ${label}`, email, password: 'password123' });
    if (!(register.body as { user?: { id: string } }).user) {
      throw new Error(
        `register failed for ${label}: ${register.status} ${JSON.stringify(register.body)}`,
      );
    }
    const userId = (register.body as { user: { id: string } }).user.id;
    const token = await login(email);
    return { token, userId, email };
  };

  // Separate from registerAndLogin so a test can obtain a SECOND, independent
  // token for the same account — which is how "another browser session" is
  // expressed here.
  const login = async (email: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'password123', role: 'USER' });
    return (res.body as { accessToken: string }).accessToken;
  };

  const questionsPayload = () => [
    {
      type: 'MULTIPLE_CHOICE',
      content: 'She ___ to the office every morning.',
      options: [
        { id: 'a', text: 'go' },
        { id: 'b', text: 'goes' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: 'Third person singular takes -s.',
    },
    {
      type: 'TRUE_FALSE',
      content: '"Goes" is the third person singular of "go".',
      correctAnswer: { value: true },
    },
  ];

  const CORRECT: Record<number, unknown> = {
    0: { optionId: 'b' },
    1: { value: true },
  };
  const WRONG: Record<number, unknown> = {
    0: { optionId: 'a' },
    1: { value: false },
  };

  const createLesson = async (
    title: string,
    opts: {
      quiz?: boolean;
      quizMode?: 'IMMEDIATE' | 'ON_SUBMIT';
      video?: boolean;
      notes?: boolean;
    } = {},
  ): Promise<string> => {
    const lesson = await prisma.lesson.create({
      data: {
        courseId,
        title: testFixtureName(title),
        orderIndex: 0,
        isPublished: true,
        videoUrl: opts.video === false ? null : 'https://youtu.be/fixture',
        notes: opts.notes === false ? null : '# Theory\nSome content.',
      },
    });

    if (opts.quiz) {
      await request(app.getHttpServer())
        .put(`/lessons/${lesson.id}/quiz`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          feedbackMode: opts.quizMode ?? 'ON_SUBMIT',
          questions: questionsPayload(),
        })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/lessons/${lesson.id}/quiz/publish`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
    }

    return lesson.id;
  };

  const postVideo = (
    lessonId: string,
    token: string,
    positionSeconds: number,
    durationSeconds = VIDEO_DURATION,
  ) =>
    request(app.getHttpServer())
      .post(`/lessons/${lessonId}/steps/video/progress`)
      .set('Authorization', `Bearer ${token}`)
      .send({ positionSeconds, durationSeconds });

  const getProgress = (lessonId: string, token: string) =>
    request(app.getHttpServer())
      .get(`/lessons/${lessonId}/progress`)
      .set('Authorization', `Bearer ${token}`);

  const quizQuestionIds = async (lessonId: string, token: string) => {
    const quiz = await request(app.getHttpServer())
      .get(`/lessons/${lessonId}/quiz`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return (
      quiz.body as { quiz: { questions: { id: string }[] } }
    ).quiz.questions.map((q) => q.id);
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    await app.init();
    prisma = app.get(PrismaService);

    const course = await prisma.course.create({
      data: {
        title: testFixtureName('Sprint 07 Course'),
        type: 'GRAMMAR',
        description: 'fixture course',
        isPublished: true,
      },
    });
    courseId = course.id;

    const email = `s07-admin-${randomUUID()}@example.test`;
    createdUserEmails.push(email);
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: 'Sprint 07 Admin', email, password: 'password123' });
    await prisma.user.update({ where: { email }, data: { role: 'ADMIN' } });
    const adminLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'password123', role: 'ADMIN' });
    adminToken = (adminLogin.body as { accessToken: string }).accessToken;
  });

  afterAll(async () => {
    await prisma.lessonStepProgress.deleteMany({
      where: { lesson: { courseId } },
    });
    await prisma.lessonTaskProgress.deleteMany({
      where: { task: { lesson: { courseId } } },
    });
    await prisma.lessonTaskAttempt.deleteMany({
      where: { task: { lesson: { courseId } } },
    });
    await prisma.question.deleteMany({
      where: { task: { lesson: { courseId } } },
    });
    await prisma.lessonTask.deleteMany({ where: { lesson: { courseId } } });
    await prisma.lesson.deleteMany({ where: { courseId } });
    await prisma.course.deleteMany({ where: { id: courseId } });
    if (createdUserEmails.length) {
      await prisma.user.deleteMany({
        where: { email: { in: createdUserEmails } },
      });
    }
    await app.close();
  });

  // --- Durability: the reason this sprint exists ---------------------------

  describe('progress is durable across refresh, re-login and sessions', () => {
    it('reloads a completed video and theory from the server', async () => {
      const lessonId = await createLesson('durable');
      const { token, email } = await registerAndLogin('durable');

      await postVideo(lessonId, token, VIDEO_DURATION).expect(201);
      await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/steps/theory/complete`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      // A refresh is just another GET.
      const refreshed = await getProgress(lessonId, token).expect(200);
      expect(refreshed.body.steps.video.completedAt).not.toBeNull();
      expect(refreshed.body.steps.theory.completedAt).not.toBeNull();

      // Logging out and back in mints a brand new token — the state must not
      // be attached to the session.
      const secondToken = await login(email);
      const afterRelogin = await getProgress(lessonId, secondToken).expect(200);
      expect(afterRelogin.body.steps.video.completedAt).toEqual(
        refreshed.body.steps.video.completedAt,
      );
      expect(afterRelogin.body.steps.theory.completedAt).toEqual(
        refreshed.body.steps.theory.completedAt,
      );
    });

    it('shows one account the same state through two independent sessions', async () => {
      const lessonId = await createLesson('two-sessions');
      const { token: sessionA, email } = await registerAndLogin('two-sess');
      const sessionB = await login(email);

      await postVideo(lessonId, sessionA, VIDEO_DURATION).expect(201);

      const fromB = await getProgress(lessonId, sessionB).expect(200);
      expect(fromB.body.steps.video.completedAt).not.toBeNull();
    });

    it('never regresses a completed step when the student reviews it', async () => {
      const lessonId = await createLesson('review');
      const { token } = await registerAndLogin('review');

      await postVideo(lessonId, token, VIDEO_DURATION).expect(201);
      const first = await getProgress(lessonId, token).expect(200);
      const completedAt = first.body.steps.video.completedAt;
      expect(completedAt).not.toBeNull();

      // Rewatch from the beginning.
      await postVideo(lessonId, token, 0).expect(201);
      await postVideo(lessonId, token, 12).expect(201);

      const after = await getProgress(lessonId, token).expect(200);
      expect(after.body.steps.video.completedAt).toEqual(completedAt);
      // And the furthest point reached is not walked backwards either.
      expect(after.body.steps.video.highestPositionSeconds).toBe(
        VIDEO_DURATION,
      );
    });

    it('is idempotent — three identical theory completions make one row', async () => {
      const lessonId = await createLesson('idempotent-theory');
      const { token, userId } = await registerAndLogin('idem-theory');

      const first = await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/steps/theory/complete`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/steps/theory/complete`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      const third = await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/steps/theory/complete`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      expect(third.body.completedAt).toEqual(first.body.completedAt);
      const rows = await prisma.lessonStepProgress.count({
        where: { userId, lessonId },
      });
      expect(rows).toBe(1);
    });

    it('separates theory IN_PROGRESS from COMPLETED', async () => {
      const lessonId = await createLesson('theory-states');
      const { token } = await registerAndLogin('theory-states');

      const started = await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/steps/theory/start`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      expect(started.body.startedAt).not.toBeNull();
      // Opening the pane must never be mistaken for having read it.
      expect(started.body.completedAt).toBeNull();

      const done = await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/steps/theory/complete`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      expect(done.body.completedAt).not.toBeNull();
      // The original start time survives completion.
      expect(done.body.startedAt).toEqual(started.body.startedAt);
    });
  });

  // --- C2: the read-only GET ----------------------------------------------

  describe('GET /lessons/:id/quiz is read-only', () => {
    it('creates no progress row and starts no attempt', async () => {
      const lessonId = await createLesson('readonly', { quiz: true });
      const { token, userId } = await registerAndLogin('readonly');

      await request(app.getHttpServer())
        .get(`/lessons/${lessonId}/quiz`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const rows = await prisma.lessonTaskProgress.count({
        where: { userId, task: { lessonId } },
      });
      expect(rows).toBe(0);
    });

    it('does not restart or re-stamp a finished attempt when it is reopened', async () => {
      const lessonId = await createLesson('reopen', { quiz: true });
      const { token, userId } = await registerAndLogin('reopen');

      const ids = await quizQuestionIds(lessonId, token);
      await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/quiz/submit`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          clientAttemptId: randomUUID(),
          answers: ids.map((questionId, i) => ({
            questionId,
            submitted: CORRECT[i],
          })),
        })
        .expect(201);

      const before = await prisma.lessonTaskProgress.findFirst({
        where: { userId, task: { lessonId } },
      });

      // Reopening the finished quiz — the exact action that used to begin a
      // new attempt behind the student's back.
      await request(app.getHttpServer())
        .get(`/lessons/${lessonId}/quiz`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const after = await prisma.lessonTaskProgress.findFirst({
        where: { userId, task: { lessonId } },
      });
      expect(after!.attemptStartedAt).toBeNull();
      expect(after!.currentAttemptSeed).toBeNull();
      expect(after!.attemptsCount).toBe(before!.attemptsCount);
      expect(after!.completedAt).toEqual(before!.completedAt);
    });

    it('returns the stored summary of the last finished attempt', async () => {
      const lessonId = await createLesson('summary', { quiz: true });
      const { token } = await registerAndLogin('summary');

      const ids = await quizQuestionIds(lessonId, token);
      await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/quiz/submit`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          clientAttemptId: randomUUID(),
          answers: ids.map((questionId, i) => ({
            questionId,
            submitted: CORRECT[i],
          })),
        })
        .expect(201);

      const reopened = await request(app.getHttpServer())
        .get(`/lessons/${lessonId}/quiz`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(reopened.body.lastResult).not.toBeNull();
      expect(reopened.body.lastResult.correctCount).toBe(2);
      expect(reopened.body.lastResult.passed).toBe(true);
      expect(reopened.body.progress.passed).toBe(true);
    });

    it('withholds the stored summary while an attempt is in flight', async () => {
      const lessonId = await createLesson('inflight', { quiz: true });
      const { token } = await registerAndLogin('inflight');

      const ids = await quizQuestionIds(lessonId, token);
      await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/quiz/submit`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          clientAttemptId: randomUUID(),
          answers: ids.map((questionId, i) => ({
            questionId,
            submitted: CORRECT[i],
          })),
        })
        .expect(201);

      // Begin a retake. The previous attempt's answers must now be hidden:
      // lastResult carries correctAnswer for every question.
      await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/quiz/start`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      const during = await request(app.getHttpServer())
        .get(`/lessons/${lessonId}/quiz`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(during.body.lastResult).toBeNull();
    });

    it('start is idempotent and does not restart an in-flight attempt', async () => {
      const lessonId = await createLesson('start-idem', { quiz: true });
      const { token, userId } = await registerAndLogin('start-idem');

      await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/quiz/start`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      const first = await prisma.lessonTaskProgress.findFirst({
        where: { userId, task: { lessonId } },
      });

      await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/quiz/start`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      const second = await prisma.lessonTaskProgress.findFirst({
        where: { userId, task: { lessonId } },
      });

      expect(second!.attemptStartedAt).toEqual(first!.attemptStartedAt);
      expect(second!.currentAttemptSeed).toEqual(first!.currentAttemptSeed);
      expect(second!.attemptsCount).toBe(0);
    });
  });

  // --- M-2 and the P2002 backstop ------------------------------------------

  describe('submit idempotency', () => {
    it('REPLAYS a duplicate submit under IMMEDIATE feedback', async () => {
      // The regression that motivated M-2: the completeness check used to run
      // before the idempotency check, and the first submit nulls
      // currentAttemptAnswers — so the replay was rejected as "incomplete" for
      // a quiz the student had just finished. IMMEDIATE is the schema default,
      // so this was the common path.
      const lessonId = await createLesson('immediate-replay', {
        quiz: true,
        quizMode: 'IMMEDIATE',
      });
      const { token } = await registerAndLogin('imm-replay');

      await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/quiz/start`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      const ids = await quizQuestionIds(lessonId, token);
      const clientAttemptId = randomUUID();

      for (const [i, questionId] of ids.entries()) {
        await request(app.getHttpServer())
          .post(`/lessons/${lessonId}/quiz/answer`)
          .set('Authorization', `Bearer ${token}`)
          .send({ questionId, clientAttemptId, submitted: CORRECT[i] })
          .expect(201);
      }

      const first = await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/quiz/submit`)
        .set('Authorization', `Bearer ${token}`)
        .send({ clientAttemptId })
        .expect(201);

      const replay = await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/quiz/submit`)
        .set('Authorization', `Bearer ${token}`)
        .send({ clientAttemptId })
        .expect(201);

      // Sprint 10 — the recorded attempt replays exactly; the award does not.
      // 30 (the pass) + 20 (FIRST_STAGE) + 20 (FIRST_QUIZ_PASS) = 70.
      expectIdempotentReplay(first.body, replay.body, 70);
      expect(replay.body.attemptsCount).toBe(1);
    });

    it('replays an id from TWO attempts ago via the history backstop, never a 500', async () => {
      const lessonId = await createLesson('deep-replay', { quiz: true });
      const { token } = await registerAndLogin('deep-replay');
      const ids = await quizQuestionIds(lessonId, token);

      const firstId = randomUUID();
      const firstAnswers = ids.map((questionId, i) => ({
        questionId,
        submitted: CORRECT[i],
      }));
      const first = await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/quiz/submit`)
        .set('Authorization', `Bearer ${token}`)
        .send({ clientAttemptId: firstId, answers: firstAnswers })
        .expect(201);

      // A second, different attempt moves lastClientAttemptId on, so the
      // depth-1 fast path can no longer recognise the first id.
      await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/quiz/submit`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          clientAttemptId: randomUUID(),
          answers: ids.map((questionId, i) => ({
            questionId,
            submitted: WRONG[i],
          })),
        })
        .expect(201);

      const replay = await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/quiz/submit`)
        .set('Authorization', `Bearer ${token}`)
        .send({ clientAttemptId: firstId, answers: firstAnswers })
        .expect(201);

      expect(replay.body.correctCount).toBe(first.body.correctCount);
      expect(replay.body.accuracyPercent).toBe(first.body.accuracyPercent);
    });

    it('409s when an old id comes back with different answers', async () => {
      const lessonId = await createLesson('deep-conflict', { quiz: true });
      const { token } = await registerAndLogin('deep-conflict');
      const ids = await quizQuestionIds(lessonId, token);

      const firstId = randomUUID();
      await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/quiz/submit`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          clientAttemptId: firstId,
          answers: ids.map((questionId, i) => ({
            questionId,
            submitted: CORRECT[i],
          })),
        })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/quiz/submit`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          clientAttemptId: randomUUID(),
          answers: ids.map((questionId, i) => ({
            questionId,
            submitted: WRONG[i],
          })),
        })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/quiz/submit`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          clientAttemptId: firstId,
          answers: ids.map((questionId, i) => ({
            questionId,
            submitted: WRONG[i],
          })),
        })
        .expect(409);
    });
  });

  // --- M3: retry preserves history -----------------------------------------

  describe('retrying preserves history', () => {
    it('keeps completion, best score and every prior attempt row', async () => {
      const lessonId = await createLesson('retry', { quiz: true });
      const { token, userId } = await registerAndLogin('retry');
      const ids = await quizQuestionIds(lessonId, token);

      await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/quiz/submit`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          clientAttemptId: randomUUID(),
          answers: ids.map((questionId, i) => ({
            questionId,
            submitted: CORRECT[i],
          })),
        })
        .expect(201);

      const afterPass = await prisma.lessonTaskProgress.findFirst({
        where: { userId, task: { lessonId } },
      });

      // A deliberately worse retake.
      const worse = await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/quiz/submit`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          clientAttemptId: randomUUID(),
          answers: ids.map((questionId, i) => ({
            questionId,
            submitted: WRONG[i],
          })),
        })
        .expect(201);

      const afterRetry = await prisma.lessonTaskProgress.findFirst({
        where: { userId, task: { lessonId } },
      });

      // Completion is historical and survives a later failure.
      expect(afterRetry!.completedAt).toEqual(afterPass!.completedAt);
      // The best score is not lowered by a worse attempt.
      expect(afterRetry!.score).toBe(afterPass!.score);
      expect(worse.body.bestScorePercent).toBe(100);
      expect(afterRetry!.attemptsCount).toBe(2);

      // Both attempts are in the append-only history, worse one included.
      const attempts = await prisma.lessonTaskAttempt.findMany({
        where: { userId, task: { lessonId } },
        orderBy: { submittedAt: 'asc' },
      });
      expect(attempts).toHaveLength(2);
      expect(attempts[0].accuracyPercent).toBe(100);
      expect(attempts[1].accuracyPercent).toBe(0);
      // The cache agrees with the history it summarises.
      expect(Math.max(...attempts.map((a) => a.accuracyPercent))).toBe(100);
    });
  });

  // --- H-1: rate-limit isolation -------------------------------------------

  describe('rate-limit buckets are isolated', () => {
    it('video traffic does not consume the quiz answering budget', async () => {
      // The bug this exists to catch: the guard keys on
      // `quiz:${kind}:${userId}`, so filing video progress under the 'answer'
      // kind would let a 10-minute video burn most of the quiz budget — and
      // present to the student as "the quiz stopped accepting answers".
      const lessonId = await createLesson('buckets', {
        quiz: true,
        quizMode: 'IMMEDIATE',
      });
      const { token } = await registerAndLogin('buckets');

      // Exhaust the 'step' bucket (150 per 600s) and then some.
      let sawStepLimit = false;
      for (let i = 0; i < 155; i += 1) {
        const res = await postVideo(lessonId, token, i);
        if (res.status === 429) {
          sawStepLimit = true;
          break;
        }
      }
      expect(sawStepLimit).toBe(true);

      // The quiz must be entirely unaffected.
      await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/quiz/start`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      const ids = await quizQuestionIds(lessonId, token);
      await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/quiz/answer`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          questionId: ids[0],
          clientAttemptId: randomUUID(),
          submitted: CORRECT[0],
        })
        .expect(201);
      // 150+ sequential round trips, and the whole e2e config runs suites in
      // parallel — the default timeout is not enough on a loaded machine.
    }, 120_000);
  });

  // --- Validation and access ------------------------------------------------

  describe('input validation and access control', () => {
    it('rejects a negative position', async () => {
      const lessonId = await createLesson('validation');
      const { token } = await registerAndLogin('validation');
      await postVideo(lessonId, token, -5).expect(400);
    });

    it('rejects a zero duration rather than dividing by it', async () => {
      const lessonId = await createLesson('zero-duration');
      const { token } = await registerAndLogin('zero-dur');
      await postVideo(lessonId, token, 0, 0).expect(400);
    });

    it('rejects a non-integer position', async () => {
      const lessonId = await createLesson('float');
      const { token } = await registerAndLogin('float');
      await postVideo(lessonId, token, 12.5).expect(400);
    });

    it('401s without a token', async () => {
      const lessonId = await createLesson('anon');
      await request(app.getHttpServer())
        .get(`/lessons/${lessonId}/progress`)
        .expect(401);
      await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/steps/theory/complete`)
        .expect(401);
    });

    it('404s on an unpublished lesson, revealing nothing', async () => {
      const lesson = await prisma.lesson.create({
        data: {
          courseId,
          title: testFixtureName('draft lesson'),
          orderIndex: 99,
          isPublished: false,
          videoUrl: 'https://youtu.be/fixture',
        },
      });
      const { token } = await registerAndLogin('draft');
      await getProgress(lesson.id, token).expect(404);
      await postVideo(lesson.id, token, 10).expect(404);
    });

    it('404s a video report on a lesson that has no video', async () => {
      const lessonId = await createLesson('novideo', { video: false });
      const { token } = await registerAndLogin('novideo');
      await postVideo(lessonId, token, 10).expect(404);
    });

    it('keeps one student progress invisible to another', async () => {
      const lessonId = await createLesson('isolation');
      const { token: alice } = await registerAndLogin('alice');
      const { token: bob } = await registerAndLogin('bob');

      await postVideo(lessonId, alice, VIDEO_DURATION).expect(201);

      const bobView = await getProgress(lessonId, bob).expect(200);
      expect(bobView.body.steps.video).toBeNull();
    });
  });

  // --- The aggregates -------------------------------------------------------

  describe('aggregated progress', () => {
    it('reports every stage for a lesson in one request', async () => {
      const lessonId = await createLesson('aggregate', { quiz: true });
      const { token } = await registerAndLogin('aggregate');

      await postVideo(lessonId, token, VIDEO_DURATION).expect(201);
      await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/steps/theory/complete`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      const res = await getProgress(lessonId, token).expect(200);
      expect(res.body.steps.video.completedAt).not.toBeNull();
      expect(res.body.steps.theory.completedAt).not.toBeNull();
      expect(res.body.quiz).not.toBeNull();
      expect(res.body.quiz.passed).toBe(false);
      // No published practice task on this lesson.
      expect(res.body.practice).toBeNull();
    });

    it('reports the quiz as passed WITHOUT the client opening the quiz', async () => {
      // H1: the lesson page never fetched quiz progress, so a passed quiz read
      // "Chưa học" in the stepper until the student opened the quiz tab.
      const lessonId = await createLesson('h1', { quiz: true });
      const { token } = await registerAndLogin('h1');
      const ids = await quizQuestionIds(lessonId, token);
      await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/quiz/submit`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          clientAttemptId: randomUUID(),
          answers: ids.map((questionId, i) => ({
            questionId,
            submitted: CORRECT[i],
          })),
        })
        .expect(201);

      const res = await getProgress(lessonId, token).expect(200);
      expect(res.body.quiz.passed).toBe(true);
      expect(res.body.quiz.bestScorePercent).toBe(100);
    });

    it('includes steps in the course aggregate', async () => {
      // Without this the course page would show every lesson as incomplete
      // once localStorage was removed, no matter how much had been watched.
      const lessonId = await createLesson('course-steps');
      const { token } = await registerAndLogin('course-steps');

      await postVideo(lessonId, token, VIDEO_DURATION).expect(201);

      const res = await request(app.getHttpServer())
        .get(`/courses/${courseId}/stage-progress`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const row = (res.body as { lessonId: string; steps: unknown }[]).find(
        (r) => r.lessonId === lessonId,
      );
      expect(row).toBeDefined();
      expect(
        (row as { steps: { video: { completedAt: string } | null } }).steps
          .video?.completedAt,
      ).not.toBeNull();
    });
  });
});
