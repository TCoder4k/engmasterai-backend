import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { testFixtureName } from './test-database.util';

// Sprint 06D — Advanced Practice. This suite is the proof for the sprint's
// hard invariants:
//
//   - the GET is READ-ONLY. Reading the stage creates no progress row, stamps
//     no attempt clock and mints no shuffle seed, so opening the intro screen
//     and walking away records nothing;
//   - a lesson with a Practice task and NO quiz is immediately available and
//     can complete — a missing prerequisite must never create an impossible
//     one;
//   - the GET succeeds while blocked and says WHY; the mutations are what
//     refuse;
//   - INDEPENDENCE: a full Practice run leaves every quiz-scoring field AND
//     trapHunterState byte-identical;
//   - client-side tampering after answers are revealed cannot improve a score.
describe('Advanced Practice (e2e) — Sprint 06D', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const createdUserEmails: string[] = [];
  let courseId: string;
  let adminToken: string;

  const registerAndLogin = async (
    label: string,
  ): Promise<{ token: string; userId: string }> => {
    // The local part of an address is capped at 64 characters by RFC 5321,
    // and class-validator's IsEmail enforces it — so a long label silently
    // produces an INVALID address and a confusing 400 from /auth/register
    // rather than anything to do with the feature under test. A uuid is 36
    // characters, so the prefix must stay short; truncating here means a
    // future descriptive label cannot reintroduce the problem.
    const email = `s6d-${label.slice(0, 20)}-${randomUUID()}@example.test`;
    createdUserEmails.push(email);
    const register = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: `Sprint 06D ${label}`, email, password: 'password123' });
    if (!(register.body as { user?: { id: string } }).user) {
      throw new Error(
        `register failed for ${label}: ${register.status} ${JSON.stringify(register.body)}`,
      );
    }
    const userId = (register.body as { user: { id: string } }).user.id;
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'password123', role: 'USER' });
    return {
      token: (login.body as { accessToken: string }).accessToken,
      userId,
    };
  };

  const questionsPayload = () => [
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Had the report been filed on time, the audit ___ smoothly.',
      options: [
        { id: 'a', text: 'will go' },
        { id: 'b', text: 'would have gone' },
        { id: 'c', text: 'goes' },
        { id: 'd', text: 'went' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: 'Third conditional pairs past perfect with would have.',
    },
    {
      type: 'TRUE_FALSE',
      content: 'Inversion can replace "if" in a conditional clause.',
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

  // Creates a lesson, optionally with a published quiz, optionally with a
  // published Practice task.
  const createLesson = async (
    title: string,
    opts: { quiz?: boolean; practice?: boolean; practiceMode?: string } = {},
  ): Promise<{ lessonId: string; practiceQuestionIds: string[] }> => {
    const lesson = await prisma.lesson.create({
      data: {
        courseId,
        title: testFixtureName(title),
        orderIndex: 0,
        isPublished: true,
        videoUrl: 'https://youtu.be/fixture',
      },
    });

    if (opts.quiz) {
      await request(app.getHttpServer())
        .put(`/lessons/${lesson.id}/quiz`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ feedbackMode: 'ON_SUBMIT', questions: questionsPayload() })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/lessons/${lesson.id}/quiz/publish`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
    }

    let practiceQuestionIds: string[] = [];
    if (opts.practice) {
      const saved = await request(app.getHttpServer())
        .put(`/lessons/${lesson.id}/practice`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          feedbackMode: opts.practiceMode ?? 'ON_SUBMIT',
          passingScorePercent: 100,
          questions: questionsPayload(),
        })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/lessons/${lesson.id}/practice/publish`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      practiceQuestionIds = (
        saved.body as { questions: { id: string }[] }
      ).questions.map((q) => q.id);
    }

    return { lessonId: lesson.id, practiceQuestionIds };
  };

  const passQuiz = async (lessonId: string, token: string) => {
    const quiz = await request(app.getHttpServer())
      .get(`/lessons/${lessonId}/quiz`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const ids = (
      quiz.body as { quiz: { questions: { id: string }[] } }
    ).quiz.questions.map((q) => q.id);
    return request(app.getHttpServer())
      .post(`/lessons/${lessonId}/quiz/submit`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        clientAttemptId: randomUUID(),
        answers: ids.map((questionId, index) => ({
          questionId,
          submitted: CORRECT[index],
        })),
      })
      .expect(201);
  };

  const getPractice = (lessonId: string, token: string) =>
    request(app.getHttpServer())
      .get(`/lessons/${lessonId}/practice`)
      .set('Authorization', `Bearer ${token}`);

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
        title: testFixtureName('Advanced Practice Course'),
        type: 'GRAMMAR',
        description: 'fixture course',
        isPublished: true,
      },
    });
    courseId = course.id;

    const email = `sprint06d-admin-${randomUUID()}@example.test`;
    createdUserEmails.push(email);
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: 'Sprint 06D Admin', email, password: 'password123' });
    await prisma.user.update({ where: { email }, data: { role: 'ADMIN' } });
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'password123', role: 'ADMIN' });
    adminToken = (login.body as { accessToken: string }).accessToken;
  });

  afterAll(async () => {
    await prisma.lessonTaskProgress.deleteMany({
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

  describe('access control', () => {
    it('401s without a token', async () => {
      const { lessonId } = await createLesson('auth', { practice: true });
      await request(app.getHttpServer())
        .get(`/lessons/${lessonId}/practice`)
        .expect(401);
    });

    it('404s for an unpublished lesson, same as the quiz surface', async () => {
      const { token } = await registerAndLogin('hidden');
      const lesson = await prisma.lesson.create({
        data: {
          courseId,
          title: testFixtureName('draft'),
          orderIndex: 9,
          isPublished: false,
          videoUrl: 'https://youtu.be/fixture',
        },
      });
      await getPractice(lesson.id, token).expect(404);
    });
  });

  // The reason POST /practice/start exists.
  describe('the GET is read-only', () => {
    it('creates no progress row, stamps no clock and mints no seed', async () => {
      const { token, userId } = await registerAndLogin('readonly');
      const { lessonId } = await createLesson('readonly', { practice: true });

      const before = await prisma.lessonTaskProgress.count({
        where: { userId },
      });
      await getPractice(lessonId, token).expect(200);
      await getPractice(lessonId, token).expect(200);
      const after = await prisma.lessonTaskProgress.findMany({
        where: { userId },
      });

      expect(before).toBe(0);
      // Reading twice must still leave nothing behind.
      expect(after).toHaveLength(0);
    });

    it('reports the task summary without starting anything', async () => {
      const { token } = await registerAndLogin('intro');
      const { lessonId } = await createLesson('intro', { practice: true });

      const res = await getPractice(lessonId, token).expect(200);
      const body = res.body as {
        task: { questionCount: number; passingScorePercent: number };
        attempt: unknown;
        progress: { attemptsCount: number };
      };

      // Everything the intro screen needs is here...
      expect(body.task.questionCount).toBe(2);
      expect(body.task.passingScorePercent).toBe(100);
      expect(body.progress.attemptsCount).toBe(0);
      // ...and no attempt exists, so no questions are sent.
      expect(body.attempt).toBeNull();
    });

    it('starting stamps the clock that the GET refused to', async () => {
      const { token, userId } = await registerAndLogin('start');
      const { lessonId } = await createLesson('start', { practice: true });

      await getPractice(lessonId, token).expect(200);
      await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/practice/start`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      const row = await prisma.lessonTaskProgress.findFirst({
        where: { userId },
      });
      expect(row?.attemptStartedAt).not.toBeNull();
      expect(row?.currentAttemptSeed).not.toBeNull();
    });

    it('starting twice does not restart the attempt or reshuffle it', async () => {
      const { token, userId } = await registerAndLogin('restart');
      const { lessonId } = await createLesson('restart', { practice: true });

      await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/practice/start`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      const first = await prisma.lessonTaskProgress.findFirst({
        where: { userId },
      });

      await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/practice/start`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      const second = await prisma.lessonTaskProgress.findFirst({
        where: { userId },
      });

      expect(second?.attemptStartedAt?.toISOString()).toBe(
        first?.attemptStartedAt?.toISOString(),
      );
      expect(second?.currentAttemptSeed).toBe(first?.currentAttemptSeed);
      expect(second?.attemptsCount).toBe(0);
    });
  });

  // The defect the plan review caught: gating on "quiz passed" alone made a
  // lesson with no quiz permanently blocked.
  describe('a lesson with a Practice task and NO quiz', () => {
    it('is immediately available', async () => {
      const { token } = await registerAndLogin('noquiz');
      const { lessonId } = await createLesson('noquiz', { practice: true });

      const res = await getPractice(lessonId, token).expect(200);
      expect(
        (res.body as { availability: { state: string } }).availability,
      ).toEqual({ state: 'available' });
    });

    it('can be started and completed, so the lesson can reach 100%', async () => {
      const { token } = await registerAndLogin('noquiz-complete');
      const { lessonId, practiceQuestionIds } = await createLesson(
        'noquiz-complete',
        { practice: true },
      );

      await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/practice/start`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      const submit = await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/practice/submit`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          clientAttemptId: randomUUID(),
          answers: practiceQuestionIds.map((questionId, index) => ({
            questionId,
            submitted: CORRECT[index],
          })),
        })
        .expect(201);

      expect((submit.body as { passed: boolean }).passed).toBe(true);
    });
  });

  describe('availability is reported on the read, enforced on the mutations', () => {
    it('GET succeeds with blocked + quiz_not_passed before the quiz is passed', async () => {
      const { token } = await registerAndLogin('blocked');
      const { lessonId } = await createLesson('blocked', {
        quiz: true,
        practice: true,
      });

      const res = await getPractice(lessonId, token).expect(200);
      expect((res.body as { availability: unknown }).availability).toEqual({
        state: 'blocked',
        reason: 'quiz_not_passed',
      });
      // The task summary is still there — the stage exists, it is just not
      // open yet, and the UI needs to say so.
      expect((res.body as { task: unknown }).task).not.toBeNull();
    });

    it('start 403s while blocked', async () => {
      const { token } = await registerAndLogin('blocked-start');
      const { lessonId } = await createLesson('blocked-start', {
        quiz: true,
        practice: true,
      });

      const res = await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/practice/start`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
      expect((res.body as { reason: string }).reason).toBe('quiz_not_passed');
    });

    it('becomes available once the quiz is passed with no mistakes', async () => {
      const { token } = await registerAndLogin('unblocked');
      const { lessonId } = await createLesson('unblocked', {
        quiz: true,
        practice: true,
      });

      await passQuiz(lessonId, token);

      const res = await getPractice(lessonId, token).expect(200);
      expect((res.body as { availability: unknown }).availability).toEqual({
        state: 'available',
      });
    });

    it('reports unavailable on a lesson with no Practice task', async () => {
      const { token } = await registerAndLogin('nopractice');
      const { lessonId } = await createLesson('nopractice', { quiz: true });

      const res = await getPractice(lessonId, token).expect(200);
      expect((res.body as { availability: unknown }).availability).toEqual({
        state: 'unavailable',
        reason: 'no_published_task',
      });
      expect((res.body as { task: unknown }).task).toBeNull();
    });

    it('refuses an answer before the attempt is started', async () => {
      const { token } = await registerAndLogin('notstarted');
      const { lessonId, practiceQuestionIds } = await createLesson(
        'notstarted',
        { practice: true, practiceMode: 'IMMEDIATE' },
      );

      await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/practice/answer`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          questionId: practiceQuestionIds[0],
          clientAttemptId: randomUUID(),
          submitted: CORRECT[0],
        })
        .expect(400);
    });
  });

  describe('scoring', () => {
    it('a failed attempt does not complete the stage', async () => {
      const { token, userId } = await registerAndLogin('fail');
      const { lessonId, practiceQuestionIds } = await createLesson('fail', {
        practice: true,
      });

      await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/practice/start`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      const submit = await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/practice/submit`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          clientAttemptId: randomUUID(),
          answers: practiceQuestionIds.map((questionId, index) => ({
            questionId,
            submitted: WRONG[index],
          })),
        })
        .expect(201);

      expect((submit.body as { passed: boolean }).passed).toBe(false);
      const row = await prisma.lessonTaskProgress.findFirst({
        where: { userId, task: { type: 'PRACTICE' } },
      });
      expect(row?.completedAt).toBeNull();
    });

    it('does not let a revealed answer be resubmitted for a better score', async () => {
      // IMMEDIATE mode reveals each correct answer as it is answered. The
      // recorded verdict is the only scoring input, so replaying a perfect
      // set afterwards must change nothing.
      const { token } = await registerAndLogin('tamper');
      const { lessonId, practiceQuestionIds } = await createLesson('tamper', {
        practice: true,
        practiceMode: 'IMMEDIATE',
      });

      await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/practice/start`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      const clientAttemptId = randomUUID();
      for (const [index, questionId] of practiceQuestionIds.entries()) {
        await request(app.getHttpServer())
          .post(`/lessons/${lessonId}/practice/answer`)
          .set('Authorization', `Bearer ${token}`)
          .send({ questionId, clientAttemptId, submitted: WRONG[index] })
          .expect(201);
      }

      const submit = await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/practice/submit`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          clientAttemptId,
          answers: practiceQuestionIds.map((questionId, index) => ({
            questionId,
            submitted: CORRECT[index],
          })),
        })
        .expect(201);

      expect((submit.body as { correctCount: number }).correctCount).toBe(0);
      expect((submit.body as { passed: boolean }).passed).toBe(false);
    });
  });

  // INDEPENDENCE. The schema already guarantees it (progress is unique per
  // user+TASK), but a regression here would be invisible and would let a
  // student inflate a quiz result by grinding practice.
  describe('Practice never touches the quiz task', () => {
    it('leaves every quiz-scoring field and trapHunterState byte-identical', async () => {
      const { token, userId } = await registerAndLogin('independent');
      const { lessonId, practiceQuestionIds } = await createLesson(
        'independent',
        { quiz: true, practice: true },
      );

      await passQuiz(lessonId, token);

      const quizBefore = await prisma.lessonTaskProgress.findFirst({
        where: { userId, task: { type: 'QUIZ' } },
      });

      await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/practice/start`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/practice/submit`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          clientAttemptId: randomUUID(),
          answers: practiceQuestionIds.map((questionId, index) => ({
            questionId,
            submitted: CORRECT[index],
          })),
        })
        .expect(201);

      const quizAfter = await prisma.lessonTaskProgress.findFirst({
        where: { userId, task: { type: 'QUIZ' } },
      });

      expect(quizAfter?.score).toBe(quizBefore?.score);
      expect(quizAfter?.maxScore).toBe(quizBefore?.maxScore);
      expect(quizAfter?.attemptsCount).toBe(quizBefore?.attemptsCount);
      expect(quizAfter?.completedAt?.toISOString()).toBe(
        quizBefore?.completedAt?.toISOString(),
      );
      expect(quizAfter?.lastAnswers).toEqual(quizBefore?.lastAnswers);
      expect(quizAfter?.lastSubmitResult).toEqual(quizBefore?.lastSubmitResult);
      expect(quizAfter?.currentAttemptAnswers).toEqual(
        quizBefore?.currentAttemptAnswers,
      );
      expect(quizAfter?.lastClientAttemptId).toBe(
        quizBefore?.lastClientAttemptId,
      );
      // Sprint 06D addition to the 06C invariant: Practice must not disturb
      // the correction round either.
      expect(quizAfter?.trapHunterState).toEqual(quizBefore?.trapHunterState);
    });

    it('records practice progress on its own row', async () => {
      const { token, userId } = await registerAndLogin('ownrow');
      const { lessonId, practiceQuestionIds } = await createLesson('ownrow', {
        quiz: true,
        practice: true,
      });

      await passQuiz(lessonId, token);
      await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/practice/start`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/practice/submit`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          clientAttemptId: randomUUID(),
          answers: practiceQuestionIds.map((questionId, index) => ({
            questionId,
            submitted: CORRECT[index],
          })),
        })
        .expect(201);

      const rows = await prisma.lessonTaskProgress.findMany({
        where: { userId },
        include: { task: { select: { type: true } } },
      });
      const types = rows.map((r) => r.task.type).sort();
      expect(types).toEqual(['PRACTICE', 'QUIZ']);
    });
  });

  describe('admin authoring', () => {
    it('refuses to publish a practice task with zero questions', async () => {
      const lesson = await prisma.lesson.create({
        data: {
          courseId,
          title: testFixtureName('empty-practice'),
          orderIndex: 5,
          isPublished: true,
          videoUrl: 'https://youtu.be/fixture',
        },
      });
      await request(app.getHttpServer())
        .put(`/lessons/${lesson.id}/practice`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ questions: [] })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/lessons/${lesson.id}/practice/publish`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
    });

    it('refuses to delete a practice task once a real attempt exists', async () => {
      const { token } = await registerAndLogin('delete-guard');
      const { lessonId, practiceQuestionIds } = await createLesson(
        'delete-guard',
        { practice: true },
      );

      await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/practice/start`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/practice/submit`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          clientAttemptId: randomUUID(),
          answers: practiceQuestionIds.map((questionId, index) => ({
            questionId,
            submitted: CORRECT[index],
          })),
        })
        .expect(201);

      await request(app.getHttpServer())
        .delete(`/lessons/${lessonId}/practice`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(409);
    });

    // Sprint 06D follow-up. The admin editor loads through
    // GET .../practice/manage, which shares a base path with the STUDENT
    // GET .../practice. Different paths, but registered by two controllers on
    // the same prefix, so this proves the admin one is actually reachable and
    // returns authoring data (correctAnswer included) rather than falling
    // through to the student route.
    it('serves the admin manage payload, distinct from the student read', async () => {
      const { lessonId } = await createLesson('manage-route', { practice: true });

      const manage = await request(app.getHttpServer())
        .get(`/lessons/${lessonId}/practice/manage`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const body = manage.body as {
        taskId: string | null;
        isPublished: boolean;
        questions: { correctAnswer: unknown }[];
      };
      expect(body.taskId).not.toBeNull();
      expect(body.isPublished).toBe(true);
      expect(body.questions).toHaveLength(2);
      // Authoring data — the student route must never carry this.
      expect(body.questions[0].correctAnswer).toBeDefined();
    });

    it('refuses the admin manage route to a non-admin', async () => {
      const { token } = await registerAndLogin('manage-forbidden');
      const { lessonId } = await createLesson('manage-forbidden', { practice: true });
      await request(app.getHttpServer())
        .get(`/lessons/${lessonId}/practice/manage`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    });

    it('round-trips a full author -> publish -> unpublish cycle', async () => {
      // The exact sequence the editor performs, proving the workflow QA
      // could not previously reach is now executable end to end.
      const lesson = await prisma.lesson.create({
        data: {
          courseId,
          title: testFixtureName('round-trip'),
          orderIndex: 7,
          isPublished: true,
          videoUrl: 'https://youtu.be/fixture',
        },
      });

      const saved = await request(app.getHttpServer())
        .put(`/lessons/${lesson.id}/practice`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ feedbackMode: 'IMMEDIATE', questions: questionsPayload() })
        .expect(200);
      expect((saved.body as { isPublished: boolean }).isPublished).toBe(false);

      const published = await request(app.getHttpServer())
        .patch(`/lessons/${lesson.id}/practice/publish`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect((published.body as { isPublished: boolean }).isPublished).toBe(true);

      // A student can now see the stage.
      const { token } = await registerAndLogin('rt-student');
      const student = await getPractice(lesson.id, token).expect(200);
      expect((student.body as { availability: { state: string } }).availability.state).toBe(
        'available',
      );

      const unpublished = await request(app.getHttpServer())
        .patch(`/lessons/${lesson.id}/practice/unpublish`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect((unpublished.body as { isPublished: boolean }).isPublished).toBe(false);

      // ...and it disappears again.
      const after = await getPractice(lesson.id, token).expect(200);
      expect((after.body as { availability: { state: string } }).availability.state).toBe(
        'unavailable',
      );
    });

    it('keeps quiz and practice as separate tasks on the same lesson', async () => {
      const { lessonId } = await createLesson('both', {
        quiz: true,
        practice: true,
      });
      const tasks = await prisma.lessonTask.findMany({
        where: { lessonId },
        select: { type: true },
      });
      expect(tasks.map((t) => t.type).sort()).toEqual(['PRACTICE', 'QUIZ']);
    });
  });

  describe('aggregated course stage progress', () => {
    it('returns one row per lesson covering every stage', async () => {
      const { token } = await registerAndLogin('aggregate');
      const { lessonId } = await createLesson('aggregate', {
        quiz: true,
        practice: true,
      });
      await passQuiz(lessonId, token);

      const res = await request(app.getHttpServer())
        .get(`/courses/${courseId}/stage-progress`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const row = (
        res.body as {
          lessonId: string;
          quiz: unknown;
          trapHunter: unknown;
          practice: unknown;
        }[]
      ).find((r) => r.lessonId === lessonId);

      expect(row).toBeDefined();
      expect(row?.quiz).toMatchObject({ passed: true });
      expect(row?.trapHunter).not.toBeNull();
      expect(row?.practice).toMatchObject({ passed: false });
    });
  });
});
