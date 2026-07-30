import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { testFixtureName, TEST_FIXTURE_PREFIX } from './test-database.util';

// Sprint 06B — the Lesson Quiz Engine. This suite is the proof for the
// sprint's own hard invariants:
//   - the student GET response never carries a correctAnswer or explanation
//     (Invariant 9);
//   - every answer is graded server-side, never trusted from the client;
//   - a lesson's quiz signal (`publishedTaskTypes`, which replaced Sprint
//     06B's `_count.tasks` in Sprint 06D) lists published tasks only, so a
//     draft quiz is invisible to students;
//   - a quiz with real attempts cannot be deleted;
//   - a repeated clientAttemptId with the same answers replays the original
//     result, and with different answers is a 409 conflict.
describe('Lesson Quiz Engine (e2e) — Sprint 06B', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const createdUserEmails: string[] = [];
  let courseId: string;
  let adminToken: string;

  const registerAndLogin = async (
    label: string,
  ): Promise<{ token: string; userId: string }> => {
    const email = `sprint06b-${label}-${randomUUID()}@example.test`;
    createdUserEmails.push(email);
    const register = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: `Sprint 06B ${label}`, email, password: 'password123' });
    // Surface the real failure — without this a rejected registration shows
    // up only as "cannot read properties of undefined" several lines later.
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

  // Four questions, one of each supported type, mirroring grade-question.spec.ts's
  // own fixtures so the e2e result is predictable by hand.
  const questionsPayload = () => [
    {
      type: 'MULTIPLE_CHOICE',
      content: 'She ___ to work every day.',
      options: [
        { id: 'a', text: 'go' },
        { id: 'b', text: 'goes' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: 'Third person singular takes -s.',
    },
    {
      type: 'TRUE_FALSE',
      content: 'The Present Simple can describe habits.',
      correctAnswer: { value: true },
    },
    {
      type: 'FILL_BLANK',
      content: 'Complete: I ___ (be) a student.',
      correctAnswer: { accepted: ['am'] },
    },
    {
      type: 'ORDERING',
      content: 'Put the words in order.',
      options: [
        { id: 'w1', text: 'I' },
        { id: 'w2', text: 'am' },
        { id: 'w3', text: 'happy' },
      ],
      correctAnswer: { orderedOptionIds: ['w1', 'w2', 'w3'] },
    },
  ];

  const allCorrectAnswers = (questionIds: string[]) => [
    { questionId: questionIds[0], submitted: { optionId: 'b' } },
    { questionId: questionIds[1], submitted: { value: true } },
    { questionId: questionIds[2], submitted: { text: 'am' } },
    {
      questionId: questionIds[3],
      submitted: { orderedOptionIds: ['w1', 'w2', 'w3'] },
    },
  ];

  const createLesson = async (title: string) =>
    prisma.lesson.create({
      data: {
        courseId,
        title: testFixtureName(title),
        orderIndex: 0,
        isPublished: true,
        videoUrl: 'https://youtu.be/fixture',
      },
    });

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
        title: testFixtureName('Quiz Engine Course'),
        type: 'GRAMMAR',
        description: 'fixture course',
        isPublished: true,
      },
    });
    courseId = course.id;

    const email = `sprint06b-admin-${randomUUID()}@example.test`;
    createdUserEmails.push(email);
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: 'Sprint 06B Admin', email, password: 'password123' });
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
    // Sprint 07 — LessonTaskAttempt.task is Restrict, so the append-only
    // attempt history must go before the tasks it belongs to. Mirrors the
    // lessonTaskProgress delete above and the order in test-fixture-sweep.ts.
    await prisma.lessonTaskAttempt.deleteMany({
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

  describe('Admin authoring (PUT/publish)', () => {
    it('rejects malformed question content before any write', async () => {
      const lesson = await createLesson('Malformed Content Lesson');
      const res = await request(app.getHttpServer())
        .put(`/lessons/${lesson.id}/quiz`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          questions: [
            {
              type: 'MULTIPLE_CHOICE',
              content: 'bad',
              options: [{ id: 'a', text: 'x' }],
              correctAnswer: { optionId: 'z' },
            },
          ],
        })
        .expect(400);
      expect((res.body as { message: string }).message).toMatch(/Question #1/);
    });

    it('saves a valid whole-document quiz', async () => {
      const lesson = await createLesson('Valid Quiz Lesson');
      const res = await request(app.getHttpServer())
        .put(`/lessons/${lesson.id}/quiz`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ passingScorePercent: 75, questions: questionsPayload() })
        .expect(200);
      expect((res.body as { questionCount: number }).questionCount).toBe(4);
      expect((res.body as { isPublished: boolean }).isPublished).toBe(false);
    });

    it('refuses to publish a quiz with zero questions', async () => {
      const lesson = await createLesson('Empty Quiz Lesson');
      await request(app.getHttpServer())
        .put(`/lessons/${lesson.id}/quiz`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ questions: [] })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/lessons/${lesson.id}/quiz/publish`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
    });

    it('a non-admin cannot reach the manage/PUT/publish routes', async () => {
      const lesson = await createLesson('Forbidden Lesson');
      const student = await registerAndLogin('forbidden');
      await request(app.getHttpServer())
        .get(`/lessons/${lesson.id}/quiz/manage`)
        .set('Authorization', `Bearer ${student.token}`)
        .expect(403);
      await request(app.getHttpServer())
        .put(`/lessons/${lesson.id}/quiz`)
        .set('Authorization', `Bearer ${student.token}`)
        .send({ questions: [] })
        .expect(403);
    });
  });

  // Sprint 06B.5 — this whole block is now ALSO the regression proof that
  // ON_SUBMIT (the original Sprint 06B flow) still behaves exactly as it
  // did before immediate feedback existed. The only change made to it was
  // declaring the mode explicitly, since the schema default flipped to
  // IMMEDIATE; every assertion below is untouched.
  describe('Student flow (GET/submit) against a published ON_SUBMIT quiz', () => {
    let lessonId: string;
    let questionIds: string[];

    beforeAll(async () => {
      const lesson = await createLesson('Student Flow Lesson');
      lessonId = lesson.id;
      const manage = await request(app.getHttpServer())
        .put(`/lessons/${lessonId}/quiz`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          passingScorePercent: 75,
          feedbackMode: 'ON_SUBMIT',
          questions: questionsPayload(),
        })
        .expect(200);
      questionIds = (
        manage.body as { questions: { id: string; content: string }[] }
      ).questions.map((q) => q.id);
      await request(app.getHttpServer())
        .patch(`/lessons/${lessonId}/quiz/publish`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
    });

    it('404s an unpublished quiz, a nonexistent lesson, and requires auth identically', async () => {
      const draftLesson = await createLesson('Still Draft Lesson');
      await request(app.getHttpServer())
        .get(`/lessons/${draftLesson.id}/quiz`)
        .expect(401); // no token at all
      const student = await registerAndLogin('404check');
      await request(app.getHttpServer())
        .get(`/lessons/${draftLesson.id}/quiz`)
        .set('Authorization', `Bearer ${student.token}`)
        .expect(404);
      await request(app.getHttpServer())
        .get(`/lessons/${randomUUID()}/quiz`)
        .set('Authorization', `Bearer ${student.token}`)
        .expect(404);
    });

    it('Invariant 9 — the student GET response never carries correctAnswer or explanation', async () => {
      const student = await registerAndLogin('invariant9');
      const res = await request(app.getHttpServer())
        .get(`/lessons/${lessonId}/quiz`)
        .set('Authorization', `Bearer ${student.token}`)
        .expect(200);

      const raw = JSON.stringify(res.body);
      expect(raw).not.toMatch(/correctAnswer/);
      expect(raw).not.toMatch(/explanation/);
      expect(
        (res.body as { quiz: { questions: unknown[] } }).quiz.questions,
      ).toHaveLength(4);
    });

    it("passes at exactly the configured threshold (3/4 = 75%) and fails below it, and never trusts the client's own verdict", async () => {
      const student = await registerAndLogin('pass-fail');
      await request(app.getHttpServer())
        .get(`/lessons/${lessonId}/quiz`)
        .set('Authorization', `Bearer ${student.token}`)
        .expect(200);

      // 3 correct, 1 wrong (the ORDERING question) = 75%, meets the threshold.
      const mostlyCorrect = [
        { questionId: questionIds[0], submitted: { optionId: 'b' } },
        { questionId: questionIds[1], submitted: { value: true } },
        { questionId: questionIds[2], submitted: { text: '  AM  ' } }, // normalisation exercised
        {
          questionId: questionIds[3],
          submitted: { orderedOptionIds: ['w2', 'w1', 'w3'] },
        },
      ];
      const firstAttempt = await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/quiz/submit`)
        .set('Authorization', `Bearer ${student.token}`)
        .send({ clientAttemptId: randomUUID(), answers: mostlyCorrect })
        .expect(201);

      const firstBody = firstAttempt.body as {
        correctCount: number;
        accuracyPercent: number;
        passed: boolean;
        attemptsCount: number;
        results: {
          questionId: string;
          isCorrect: boolean;
          correctAnswer: unknown;
        }[];
      };
      expect(firstBody.correctCount).toBe(3);
      expect(firstBody.accuracyPercent).toBe(75);
      expect(firstBody.passed).toBe(true);
      expect(firstBody.attemptsCount).toBe(1);
      // This response carries the real correctAnswer — the one place it's allowed.
      const ordering = firstBody.results.find(
        (r) => r.questionId === questionIds[3],
      )!;
      expect(ordering.isCorrect).toBe(false);
      expect(ordering.correctAnswer).toEqual({
        orderedOptionIds: ['w1', 'w2', 'w3'],
      });

      // A second, worse attempt: passed:false for THIS attempt, but the
      // lesson's own completedAt (surfaced via GET) must stay true — a
      // later failed retry never un-completes a lesson.
      const halfCorrect = [
        { questionId: questionIds[0], submitted: { optionId: 'a' } }, // wrong now
        { questionId: questionIds[1], submitted: { value: true } },
        { questionId: questionIds[2], submitted: { text: 'am' } },
        {
          questionId: questionIds[3],
          submitted: { orderedOptionIds: ['w2', 'w1', 'w3'] },
        }, // still wrong
      ];
      const secondAttempt = await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/quiz/submit`)
        .set('Authorization', `Bearer ${student.token}`)
        .send({ clientAttemptId: randomUUID(), answers: halfCorrect })
        .expect(201);
      const secondBody = secondAttempt.body as {
        accuracyPercent: number;
        passed: boolean;
        attemptsCount: number;
      };
      expect(secondBody.accuracyPercent).toBe(50);
      expect(secondBody.passed).toBe(false);
      expect(secondBody.attemptsCount).toBe(2);

      const afterFail = await request(app.getHttpServer())
        .get(`/lessons/${lessonId}/quiz`)
        .set('Authorization', `Bearer ${student.token}`)
        .expect(200);
      const progress = (
        afterFail.body as {
          progress: {
            passed: boolean;
            attemptsCount: number;
            bestScorePercent: number;
          };
        }
      ).progress;
      expect(progress.passed).toBe(true); // never cleared
      expect(progress.attemptsCount).toBe(2);
      expect(progress.bestScorePercent).toBe(75); // 50% did not beat the earlier 75% best
    });

    it('replays an identical clientAttemptId+answers pair, and 409s the same id with different answers', async () => {
      const student = await registerAndLogin('idempotency');
      await request(app.getHttpServer())
        .get(`/lessons/${lessonId}/quiz`)
        .set('Authorization', `Bearer ${student.token}`)
        .expect(200);

      const clientAttemptId = randomUUID();
      const answers = allCorrectAnswers(questionIds);

      const first = await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/quiz/submit`)
        .set('Authorization', `Bearer ${student.token}`)
        .send({ clientAttemptId, answers })
        .expect(201);

      const replay = await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/quiz/submit`)
        .set('Authorization', `Bearer ${student.token}`)
        .send({ clientAttemptId, answers })
        .expect(201);
      expect(replay.body).toEqual(first.body);
      expect((replay.body as { attemptsCount: number }).attemptsCount).toBe(1); // not incremented again

      const conflictingAnswers = allCorrectAnswers(questionIds).map((a, i) =>
        i === 0
          ? { questionId: a.questionId, submitted: { optionId: 'a' } }
          : a,
      );
      const conflict = await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/quiz/submit`)
        .set('Authorization', `Bearer ${student.token}`)
        .send({ clientAttemptId, answers: conflictingAnswers })
        .expect(409);
      expect((conflict.body as { code: string }).code).toBe(
        'QUIZ_IDEMPOTENCY_CONFLICT',
      );
    });

    it('reports course-wide quiz progress for a completed lesson', async () => {
      const student = await registerAndLogin('course-progress');
      await request(app.getHttpServer())
        .get(`/lessons/${lessonId}/quiz`)
        .set('Authorization', `Bearer ${student.token}`)
        .expect(200);
      await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/quiz/submit`)
        .set('Authorization', `Bearer ${student.token}`)
        .send({
          clientAttemptId: randomUUID(),
          answers: allCorrectAnswers(questionIds),
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/courses/${courseId}/quiz-progress`)
        .set('Authorization', `Bearer ${student.token}`)
        .expect(200);
      const row = (
        res.body as {
          data: { lessonId: string; passed: boolean; attemptsCount: number }[];
        }
      ).data.find((r) => r.lessonId === lessonId);
      expect(row).toBeDefined();
      expect(row!.passed).toBe(true);
      expect(row!.attemptsCount).toBe(1);
    });

    it("lists this lesson's published quiz in publishedTaskTypes, and nothing while still a draft", async () => {
      const student = await registerAndLogin('count-check');
      const draftLesson = await createLesson('Count Check Draft Lesson');
      await request(app.getHttpServer())
        .put(`/lessons/${draftLesson.id}/quiz`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ questions: questionsPayload() })
        .expect(200);

      const beforePublish = await request(app.getHttpServer())
        .get(`/courses/${courseId}/lessons`)
        .set('Authorization', `Bearer ${student.token}`)
        .expect(200);
      const rowBefore = (
        beforePublish.body as {
          data: { id: string; publishedTaskTypes: string[] }[];
        }
      ).data.find((l) => l.id === draftLesson.id);
      // Sprint 06D — an unpublished quiz must not appear at all. The old
      // assertion was `_count.tasks === 0`; the meaning is unchanged.
      expect(rowBefore!.publishedTaskTypes).not.toContain('QUIZ');

      await request(app.getHttpServer())
        .patch(`/lessons/${draftLesson.id}/quiz/publish`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const afterPublish = await request(app.getHttpServer())
        .get(`/courses/${courseId}/lessons`)
        .set('Authorization', `Bearer ${student.token}`)
        .expect(200);
      const rowAfter = (
        afterPublish.body as {
          data: { id: string; publishedTaskTypes: string[] }[];
        }
      ).data.find((l) => l.id === draftLesson.id);
      expect(rowAfter!.publishedTaskTypes).toContain('QUIZ');
      // No practice task was authored for this lesson, so the signal that
      // drives Sprint 06D's stage must stay absent.
      expect(rowAfter!.publishedTaskTypes).not.toContain('PRACTICE');
    });
  });

  // Sprint 06B.5 — IMMEDIATE feedback. The security property under test
  // here is that revealing a correct answer per question does NOT let the
  // client decide its own score: grading happens once, server-side, at
  // first-answer time, and submit reads only that record.
  describe('Immediate feedback flow (POST .../quiz/answer)', () => {
    let lessonId: string;
    let questionIds: string[];

    const answerBody = (
      clientAttemptId: string,
      questionId: string,
      submitted: unknown,
    ) => ({ clientAttemptId, questionId, submitted });

    beforeAll(async () => {
      const lesson = await createLesson('Immediate Feedback Lesson');
      lessonId = lesson.id;
      const manage = await request(app.getHttpServer())
        .put(`/lessons/${lessonId}/quiz`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          passingScorePercent: 75,
          feedbackMode: 'IMMEDIATE',
          questions: questionsPayload(),
        })
        .expect(200);
      questionIds = (
        manage.body as { questions: { id: string }[] }
      ).questions.map((q) => q.id);
      await request(app.getHttpServer())
        .patch(`/lessons/${lessonId}/quiz/publish`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
    });

    it('grades one question at a time and returns its correct answer and authored explanation', async () => {
      const student = await registerAndLogin('immediate-basic');
      const attemptId = randomUUID();
      await request(app.getHttpServer())
        .get(`/lessons/${lessonId}/quiz`)
        .set('Authorization', `Bearer ${student.token}`)
        .expect(200);

      const wrong = await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/quiz/answer`)
        .set('Authorization', `Bearer ${student.token}`)
        .send(answerBody(attemptId, questionIds[0], { optionId: 'a' }))
        .expect(201);
      const wrongBody = wrong.body as {
        isCorrect: boolean;
        correctAnswer: unknown;
        explanation: string | null;
        answeredCount: number;
        totalCount: number;
        currentStreak: number;
        allAnswered: boolean;
      };
      expect(wrongBody.isCorrect).toBe(false);
      expect(wrongBody.correctAnswer).toEqual({ optionId: 'b' });
      expect(wrongBody.explanation).toBe('Third person singular takes -s.');
      expect(wrongBody.answeredCount).toBe(1);
      expect(wrongBody.totalCount).toBe(4);
      expect(wrongBody.currentStreak).toBe(0);
      expect(wrongBody.allAnswered).toBe(false);

      // The TRUE_FALSE question has no authored explanation — the response
      // says so with null rather than inventing one.
      const right = await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/quiz/answer`)
        .set('Authorization', `Bearer ${student.token}`)
        .send(answerBody(attemptId, questionIds[1], { value: true }))
        .expect(201);
      const rightBody = right.body as {
        isCorrect: boolean;
        explanation: string | null;
        currentStreak: number;
      };
      expect(rightBody.isCorrect).toBe(true);
      expect(rightBody.explanation).toBeNull();
      expect(rightBody.currentStreak).toBe(1);
    });

    it('locks a graded question — re-answering replays the first verdict and cannot change it', async () => {
      const student = await registerAndLogin('immediate-lock');
      const attemptId = randomUUID();
      await request(app.getHttpServer())
        .get(`/lessons/${lessonId}/quiz`)
        .set('Authorization', `Bearer ${student.token}`)
        .expect(200);

      await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/quiz/answer`)
        .set('Authorization', `Bearer ${student.token}`)
        .send(answerBody(attemptId, questionIds[0], { optionId: 'a' }))
        .expect(201);

      // Now answer the SAME question correctly, having just been told the
      // correct option. The first verdict stands.
      const retry = await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/quiz/answer`)
        .set('Authorization', `Bearer ${student.token}`)
        .send(answerBody(attemptId, questionIds[0], { optionId: 'b' }))
        .expect(201);
      expect((retry.body as { isCorrect: boolean }).isCorrect).toBe(false);
      expect((retry.body as { answeredCount: number }).answeredCount).toBe(1);
    });

    it('refuses to finish while questions remain unanswered', async () => {
      const student = await registerAndLogin('imm-incomplete');
      const attemptId = randomUUID();
      await request(app.getHttpServer())
        .get(`/lessons/${lessonId}/quiz`)
        .set('Authorization', `Bearer ${student.token}`)
        .expect(200);
      await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/quiz/answer`)
        .set('Authorization', `Bearer ${student.token}`)
        .send(answerBody(attemptId, questionIds[0], { optionId: 'b' }))
        .expect(201);

      await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/quiz/submit`)
        .set('Authorization', `Bearer ${student.token}`)
        .send({ clientAttemptId: attemptId })
        .expect(400);
    });

    it('scores ONLY from the server record — a client that resubmits the revealed answers still fails', async () => {
      const student = await registerAndLogin('immediate-cheat');
      const attemptId = randomUUID();
      await request(app.getHttpServer())
        .get(`/lessons/${lessonId}/quiz`)
        .set('Authorization', `Bearer ${student.token}`)
        .expect(200);

      // Answer every question WRONG, harvesting each correct answer from
      // the feedback as it comes back.
      const wrongAnswers: unknown[] = [
        { optionId: 'a' },
        { value: false },
        { text: 'is' },
        { orderedOptionIds: ['w3', 'w2', 'w1'] },
      ];
      for (let i = 0; i < questionIds.length; i++) {
        await request(app.getHttpServer())
          .post(`/lessons/${lessonId}/quiz/answer`)
          .set('Authorization', `Bearer ${student.token}`)
          .send(answerBody(attemptId, questionIds[i], wrongAnswers[i]))
          .expect(201);
      }

      // Now submit the PERFECT answer set the server just handed over.
      // This is the attack the design exists to defeat.
      const finish = await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/quiz/submit`)
        .set('Authorization', `Bearer ${student.token}`)
        .send({
          clientAttemptId: attemptId,
          answers: allCorrectAnswers(questionIds),
        })
        .expect(201);

      const body = finish.body as {
        correctCount: number;
        accuracyPercent: number;
        passed: boolean;
        results: { isCorrect: boolean; submitted: unknown }[];
      };
      expect(body.correctCount).toBe(0);
      expect(body.accuracyPercent).toBe(0);
      expect(body.passed).toBe(false);
      expect(body.results.every((r) => !r.isCorrect)).toBe(true);
      // The recorded submissions, not the ones the client just sent.
      expect(body.results[0].submitted).toEqual({ optionId: 'a' });
    });

    it('Invariant 9 (06B.5 form) — a fresh attempt leaks nothing; an answered question carries its own result', async () => {
      const student = await registerAndLogin('imm-inv9');
      const attemptId = randomUUID();

      const fresh = await request(app.getHttpServer())
        .get(`/lessons/${lessonId}/quiz`)
        .set('Authorization', `Bearer ${student.token}`)
        .expect(200);
      const freshRaw = JSON.stringify(fresh.body);
      // Nothing answered yet: no correct answer, no explanation, anywhere.
      expect(freshRaw).not.toMatch(/"correctAnswer"/);
      expect(freshRaw).not.toMatch(/"explanation"/);
      expect(
        (
          fresh.body as { quiz: { questions: { answered: unknown }[] } }
        ).quiz.questions.every((q) => q.answered === null),
      ).toBe(true);

      await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/quiz/answer`)
        .set('Authorization', `Bearer ${student.token}`)
        .send(answerBody(attemptId, questionIds[0], { optionId: 'a' }))
        .expect(201);

      const resumed = await request(app.getHttpServer())
        .get(`/lessons/${lessonId}/quiz`)
        .set('Authorization', `Bearer ${student.token}`)
        .expect(200);
      const questions = (
        resumed.body as {
          quiz: {
            questions: {
              id: string;
              answered: {
                isCorrect: boolean;
                correctAnswer: unknown;
                submitted: unknown;
              } | null;
            }[];
          };
        }
      ).quiz.questions;

      // The one answered question restores its feedback (the student has
      // already seen it) …
      const answered = questions.find((q) => q.id === questionIds[0])!;
      expect(answered.answered).not.toBeNull();
      expect(answered.answered!.isCorrect).toBe(false);
      expect(answered.answered!.correctAnswer).toEqual({ optionId: 'b' });
      expect(answered.answered!.submitted).toEqual({ optionId: 'a' });

      // … and every UNANSWERED question is still sealed.
      questions
        .filter((q) => q.id !== questionIds[0])
        .forEach((q) => expect(q.answered).toBeNull());
    });

    it('keeps ORDERING option order stable across reloads within one attempt', async () => {
      const student = await registerAndLogin('immediate-seed');
      const readOrder = async () => {
        const res = await request(app.getHttpServer())
          .get(`/lessons/${lessonId}/quiz`)
          .set('Authorization', `Bearer ${student.token}`)
          .expect(200);
        const ordering = (
          res.body as {
            quiz: { questions: { type: string; options: { id: string }[] }[] };
          }
        ).quiz.questions.find((q) => q.type === 'ORDERING')!;
        return ordering.options.map((o) => o.id).join(',');
      };
      expect(await readOrder()).toBe(await readOrder());
    });

    it('rejects per-question answering on an ON_SUBMIT quiz, and 404s a foreign question id', async () => {
      const student = await registerAndLogin('immediate-guards');
      await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/quiz/answer`)
        .send(answerBody(randomUUID(), questionIds[0], { optionId: 'b' }))
        .expect(401); // no token

      await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/quiz/answer`)
        .set('Authorization', `Bearer ${student.token}`)
        .send(answerBody(randomUUID(), randomUUID(), { optionId: 'b' }))
        .expect(404); // real quiz, question that isn't part of it

      const onSubmitLesson = await createLesson('On Submit Guard Lesson');
      await request(app.getHttpServer())
        .put(`/lessons/${onSubmitLesson.id}/quiz`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ feedbackMode: 'ON_SUBMIT', questions: questionsPayload() })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/lessons/${onSubmitLesson.id}/quiz/publish`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const manage = await request(app.getHttpServer())
        .get(`/lessons/${onSubmitLesson.id}/quiz/manage`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const onSubmitQuestionId = (
        manage.body as { questions: { id: string }[] }
      ).questions[0].id;

      await request(app.getHttpServer())
        .post(`/lessons/${onSubmitLesson.id}/quiz/answer`)
        .set('Authorization', `Bearer ${student.token}`)
        .send(answerBody(randomUUID(), onSubmitQuestionId, { optionId: 'b' }))
        .expect(400);
    });

    it('completes a full passing attempt and reports a real streak', async () => {
      const student = await registerAndLogin('immediate-pass');
      const attemptId = randomUUID();
      await request(app.getHttpServer())
        .get(`/lessons/${lessonId}/quiz`)
        .set('Authorization', `Bearer ${student.token}`)
        .expect(200);

      const correct = allCorrectAnswers(questionIds);
      let lastStreak = 0;
      for (const answer of correct) {
        const res = await request(app.getHttpServer())
          .post(`/lessons/${lessonId}/quiz/answer`)
          .set('Authorization', `Bearer ${student.token}`)
          .send(answerBody(attemptId, answer.questionId, answer.submitted))
          .expect(201);
        lastStreak = (res.body as { currentStreak: number }).currentStreak;
      }
      expect(lastStreak).toBe(4);

      const finish = await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/quiz/submit`)
        .set('Authorization', `Bearer ${student.token}`)
        .send({ clientAttemptId: attemptId })
        .expect(201);
      const body = finish.body as {
        correctCount: number;
        accuracyPercent: number;
        passed: boolean;
        attemptsCount: number;
      };
      expect(body.correctCount).toBe(4);
      expect(body.accuracyPercent).toBe(100);
      expect(body.passed).toBe(true);
      expect(body.attemptsCount).toBe(1);

      // The in-flight record is cleared once the attempt is finalized, so
      // the next GET starts a genuinely fresh attempt.
      const afterFinish = await request(app.getHttpServer())
        .get(`/lessons/${lessonId}/quiz`)
        .set('Authorization', `Bearer ${student.token}`)
        .expect(200);
      expect(
        (
          afterFinish.body as { quiz: { questions: { answered: unknown }[] } }
        ).quiz.questions.every((q) => q.answered === null),
      ).toBe(true);
    });

    // Regression: the GET used to withhold the in-flight attempt id, so a
    // client that lost its sessionStorage draft (new tab, restored session,
    // cleared storage) minted a fresh one. The answer endpoint treats an
    // unrecognised id as a retake and starts the record over, so every
    // answer already recorded was silently discarded — and submit then
    // rejected the attempt as incomplete for questions the student could
    // plainly see marked as answered.
    it('hands back the in-flight attempt id so a client that lost its draft resumes the same attempt', async () => {
      const student = await registerAndLogin('imm-resume');
      const original = randomUUID();
      const correct = allCorrectAnswers(questionIds);

      await request(app.getHttpServer())
        .get(`/lessons/${lessonId}/quiz`)
        .set('Authorization', `Bearer ${student.token}`)
        .expect(200);

      // Answer the first half under the original id.
      for (const answer of correct.slice(0, 2)) {
        await request(app.getHttpServer())
          .post(`/lessons/${lessonId}/quiz/answer`)
          .set('Authorization', `Bearer ${student.token}`)
          .send(answerBody(original, answer.questionId, answer.submitted))
          .expect(201);
      }

      // What a reloaded client sees. The id must come back, because that is
      // the only way it can keep answering into the same record.
      const resumed = await request(app.getHttpServer())
        .get(`/lessons/${lessonId}/quiz`)
        .set('Authorization', `Bearer ${student.token}`)
        .expect(200);
      const resumedQuiz = (
        resumed.body as {
          quiz: {
            currentAttemptId: string | null;
            questions: { answered: unknown }[];
          };
        }
      ).quiz;
      expect(resumedQuiz.currentAttemptId).toBe(original);
      expect(
        resumedQuiz.questions.filter((q) => q.answered !== null),
      ).toHaveLength(2);

      // Finish using the id the server handed back, exactly as the client does.
      for (const answer of correct.slice(2)) {
        await request(app.getHttpServer())
          .post(`/lessons/${lessonId}/quiz/answer`)
          .set('Authorization', `Bearer ${student.token}`)
          .send(
            answerBody(
              resumedQuiz.currentAttemptId as string,
              answer.questionId,
              answer.submitted,
            ),
          )
          .expect(201);
      }

      const finish = await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/quiz/submit`)
        .set('Authorization', `Bearer ${student.token}`)
        .send({ clientAttemptId: original })
        .expect(201);
      expect((finish.body as { correctCount: number }).correctCount).toBe(4);
    });

    it('still treats a genuinely new attempt id as a retake, discarding the half-finished record', async () => {
      const student = await registerAndLogin('imm-retake');
      const first = randomUUID();
      const correct = allCorrectAnswers(questionIds);

      for (const answer of correct.slice(0, 3)) {
        await request(app.getHttpServer())
          .post(`/lessons/${lessonId}/quiz/answer`)
          .set('Authorization', `Bearer ${student.token}`)
          .send(answerBody(first, answer.questionId, answer.submitted))
          .expect(201);
      }

      // A different id means "start over" — that behaviour is deliberate and
      // is what makes retake work; the fix above is that clients no longer
      // trigger it by accident.
      const second = randomUUID();
      const afterRetake = await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/quiz/answer`)
        .set('Authorization', `Bearer ${student.token}`)
        .send(answerBody(second, correct[0].questionId, correct[0].submitted))
        .expect(201);
      expect(
        (afterRetake.body as { answeredCount: number }).answeredCount,
      ).toBe(1);

      const blocked = await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/quiz/submit`)
        .set('Authorization', `Bearer ${student.token}`)
        .send({ clientAttemptId: second })
        .expect(400);
      expect((blocked.body as { message: string }).message).toContain('3');
    });
  });

  describe('Deletion', () => {
    it('refuses to delete a quiz with real attempts', async () => {
      const lesson = await createLesson('Delete Refused Lesson');
      const manage = await request(app.getHttpServer())
        .put(`/lessons/${lesson.id}/quiz`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ feedbackMode: 'ON_SUBMIT', questions: questionsPayload() })
        .expect(200);
      const questionIds = (
        manage.body as { questions: { id: string }[] }
      ).questions.map((q) => q.id);
      await request(app.getHttpServer())
        .patch(`/lessons/${lesson.id}/quiz/publish`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const student = await registerAndLogin('delete-refused');
      await request(app.getHttpServer())
        .get(`/lessons/${lesson.id}/quiz`)
        .set('Authorization', `Bearer ${student.token}`)
        .expect(200);
      await request(app.getHttpServer())
        .post(`/lessons/${lesson.id}/quiz/submit`)
        .set('Authorization', `Bearer ${student.token}`)
        .send({
          clientAttemptId: randomUUID(),
          answers: allCorrectAnswers(questionIds),
        })
        .expect(201);

      await request(app.getHttpServer())
        .delete(`/lessons/${lesson.id}/quiz`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(409);
    });

    it('deletes a quiz with no attempts', async () => {
      const lesson = await createLesson('Delete Allowed Lesson');
      await request(app.getHttpServer())
        .put(`/lessons/${lesson.id}/quiz`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ questions: questionsPayload() })
        .expect(200);

      await request(app.getHttpServer())
        .delete(`/lessons/${lesson.id}/quiz`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(204);

      const manage = await request(app.getHttpServer())
        .get(`/lessons/${lesson.id}/quiz/manage`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect((manage.body as { taskId: string | null }).taskId).toBeNull();
    });
  });

  describe('fixture containment', () => {
    it('keeps every fixture lesson inside the test namespace', async () => {
      const lessons = await prisma.lesson.findMany({ where: { courseId } });
      lessons.forEach((lesson) =>
        expect(lesson.title.startsWith(TEST_FIXTURE_PREFIX)).toBe(true),
      );
    });
  });
});
