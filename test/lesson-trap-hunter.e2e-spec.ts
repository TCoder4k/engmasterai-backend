import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { testFixtureName } from './test-database.util';

// Sprint 06C — Trap Hunter. This suite is the proof for the sprint's hard
// invariants:
//   - traps are EXACTLY the wrong answers of the most recent completed
//     attempt, and a perfect attempt produces none;
//   - INVARIANT B: a full correction round leaves every quiz-scoring field
//     byte-identical — score, maxScore, attemptsCount, completedAt,
//     lastAnswers, lastSubmitResult, currentAttemptAnswers;
//   - a trap only clears on a correct answer, and re-answering a cleared one
//     replays without a write;
//   - retaking the quiz re-derives traps and discards the old cleared flags;
//   - an uncleared trap with no hint unlocked carries neither correctAnswer
//     nor explanation;
//   - hint levels are recorded, survive a re-GET, and NEVER affect whether a
//     trap can be cleared.
describe('Trap Hunter (e2e) — Sprint 06C', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const createdUserEmails: string[] = [];
  let courseId: string;
  let adminToken: string;

  const registerAndLogin = async (
    label: string,
  ): Promise<{ token: string; userId: string }> => {
    const email = `sprint06c-${label}-${randomUUID()}@example.test`;
    createdUserEmails.push(email);
    const register = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: `Sprint 06C ${label}`, email, password: 'password123' });
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

  // Four questions, one per supported type. Only the first two carry an
  // authored explanation — the other two are what proves an absent one shows
  // nothing rather than a generated substitute.
  const questionsPayload = () => [
    {
      type: 'MULTIPLE_CHOICE',
      content: 'She ___ to work every day.',
      options: [
        { id: 'a', text: 'go' },
        { id: 'b', text: 'goes' },
        { id: 'c', text: 'going' },
        { id: 'd', text: 'gone' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: 'Third person singular takes -s.',
    },
    {
      type: 'TRUE_FALSE',
      content: 'The Present Simple can describe habits.',
      correctAnswer: { value: true },
      explanation: 'Habits are one of its core uses.',
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

  const CORRECT: Record<number, unknown> = {
    0: { optionId: 'b' },
    1: { value: true },
    2: { text: 'am' },
    3: { orderedOptionIds: ['w1', 'w2', 'w3'] },
  };
  const WRONG: Record<number, unknown> = {
    0: { optionId: 'a' },
    1: { value: false },
    2: { text: 'is' },
    3: { orderedOptionIds: ['w3', 'w2', 'w1'] },
  };

  // Builds a published ON_SUBMIT quiz. ON_SUBMIT deliberately: it lets a
  // whole attempt be finished in ONE request, and it also demonstrates that
  // Trap Hunter never branches on feedbackMode — the traps below come out
  // identical either way.
  const createPublishedQuiz = async (
    title: string,
  ): Promise<{ lessonId: string; questionIds: string[] }> => {
    const lesson = await prisma.lesson.create({
      data: {
        courseId,
        title: testFixtureName(title),
        orderIndex: 0,
        isPublished: true,
        videoUrl: 'https://youtu.be/fixture',
      },
    });
    const saved = await request(app.getHttpServer())
      .put(`/lessons/${lesson.id}/quiz`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ feedbackMode: 'ON_SUBMIT', questions: questionsPayload() })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/lessons/${lesson.id}/quiz/publish`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    return {
      lessonId: lesson.id,
      questionIds: (saved.body as { questions: { id: string }[] }).questions.map(
        (question) => question.id,
      ),
    };
  };

  // Submits one attempt, answering the indices in `wrongIndexes` incorrectly.
  const submitAttempt = async (
    lessonId: string,
    questionIds: string[],
    token: string,
    wrongIndexes: number[],
  ) => {
    await request(app.getHttpServer())
      .get(`/lessons/${lessonId}/quiz`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return request(app.getHttpServer())
      .post(`/lessons/${lessonId}/quiz/submit`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        clientAttemptId: randomUUID(),
        answers: questionIds.map((questionId, index) => ({
          questionId,
          submitted: wrongIndexes.includes(index) ? WRONG[index] : CORRECT[index],
        })),
      })
      .expect(201);
  };

  const getTraps = async (lessonId: string, token: string) =>
    request(app.getHttpServer())
      .get(`/lessons/${lessonId}/trap-hunter`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

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
        title: testFixtureName('Trap Hunter Course'),
        type: 'GRAMMAR',
        description: 'fixture course',
        isPublished: true,
      },
    });
    courseId = course.id;

    const email = `sprint06c-admin-${randomUUID()}@example.test`;
    createdUserEmails.push(email);
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: 'Sprint 06C Admin', email, password: 'password123' });
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

  describe('Where traps come from', () => {
    it('is blocked before any attempt is finished — not empty, which would read as "you made no mistakes"', async () => {
      const { lessonId } = await createPublishedQuiz('Blocked Lesson');
      const student = await registerAndLogin('blocked');

      const res = await getTraps(lessonId, student.token);
      expect(res.body.progress).toEqual({
        hasSource: false,
        total: 0,
        cleared: 0,
        completed: false,
      });
      expect(res.body.traps).toEqual([]);

      // And answering is refused outright rather than 404ing on the question.
      await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/trap-hunter/answer`)
        .set('Authorization', `Bearer ${student.token}`)
        .send({ questionId: randomUUID(), submitted: { optionId: 'b' } })
        .expect(400);
    });

    it('contains exactly the questions answered incorrectly — and nothing else', async () => {
      const { lessonId, questionIds } = await createPublishedQuiz('Two Wrong Lesson');
      const student = await registerAndLogin('two-wrong');
      await submitAttempt(lessonId, questionIds, student.token, [0, 2]);

      const res = await getTraps(lessonId, student.token);
      const trapIds = res.body.traps.map((trap: { questionId: string }) => trap.questionId);
      expect(trapIds.sort()).toEqual([questionIds[0], questionIds[2]].sort());
      expect(res.body.progress).toEqual({
        hasSource: true,
        total: 2,
        cleared: 0,
        completed: false,
      });
    });

    it('carries the student’s own wrong answer so they can see what is being corrected', async () => {
      const { lessonId, questionIds } = await createPublishedQuiz('Wrong Answer Echo');
      const student = await registerAndLogin('echo');
      await submitAttempt(lessonId, questionIds, student.token, [0]);

      const res = await getTraps(lessonId, student.token);
      expect(res.body.traps[0].wrongAnswer).toEqual({ optionId: 'a' });
    });

    it('produces NO traps for a perfect attempt — and reports it as a real source, not a missing one', async () => {
      const { lessonId, questionIds } = await createPublishedQuiz('Perfect Lesson');
      const student = await registerAndLogin('perfect');
      await submitAttempt(lessonId, questionIds, student.token, []);

      const res = await getTraps(lessonId, student.token);
      expect(res.body.traps).toEqual([]);
      // hasSource true + total 0 is what the frontend renders as 'skipped'
      // ("No traps — perfect quiz") rather than 'blocked' or 'unavailable'.
      expect(res.body.progress.hasSource).toBe(true);
      expect(res.body.progress.total).toBe(0);
      expect(res.body.progress.completed).toBe(false);
    });
  });

  describe('Correcting a trap', () => {
    it('clears on a correct answer and reveals the authored explanation', async () => {
      const { lessonId, questionIds } = await createPublishedQuiz('Clear One');
      const student = await registerAndLogin('clear-one');
      await submitAttempt(lessonId, questionIds, student.token, [0, 1]);

      const res = await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/trap-hunter/answer`)
        .set('Authorization', `Bearer ${student.token}`)
        .send({ questionId: questionIds[0], submitted: CORRECT[0] })
        .expect(201);

      expect(res.body.isCorrect).toBe(true);
      expect(res.body.correctAnswer).toEqual({ optionId: 'b' });
      expect(res.body.explanation).toBe('Third person singular takes -s.');
      expect(res.body.clearedCount).toBe(1);
      expect(res.body.totalCount).toBe(2);
      expect(res.body.allCleared).toBe(false);
    });

    it('does NOT clear on a wrong answer — it counts the attempt and the trap stays open', async () => {
      const { lessonId, questionIds } = await createPublishedQuiz('Miss Once');
      const student = await registerAndLogin('miss-once');
      await submitAttempt(lessonId, questionIds, student.token, [0]);

      const missed = await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/trap-hunter/answer`)
        .set('Authorization', `Bearer ${student.token}`)
        .send({ questionId: questionIds[0], submitted: { optionId: 'c' } })
        .expect(201);
      expect(missed.body.isCorrect).toBe(false);
      expect(missed.body.attempts).toBe(1);
      expect(missed.body.clearedCount).toBe(0);

      const res = await getTraps(lessonId, student.token);
      expect(res.body.traps[0].cleared).toBeNull();
      expect(res.body.traps[0].attempts).toBe(1);
      expect(res.body.progress.completed).toBe(false);
    });

    it('completes the stage only once EVERY trap is corrected', async () => {
      const { lessonId, questionIds } = await createPublishedQuiz('Clear All');
      const student = await registerAndLogin('clear-all');
      await submitAttempt(lessonId, questionIds, student.token, [1, 3]);

      const first = await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/trap-hunter/answer`)
        .set('Authorization', `Bearer ${student.token}`)
        .send({ questionId: questionIds[1], submitted: CORRECT[1] })
        .expect(201);
      expect(first.body.allCleared).toBe(false);

      const second = await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/trap-hunter/answer`)
        .set('Authorization', `Bearer ${student.token}`)
        .send({ questionId: questionIds[3], submitted: CORRECT[3] })
        .expect(201);
      expect(second.body.allCleared).toBe(true);

      const res = await getTraps(lessonId, student.token);
      expect(res.body.progress).toEqual({
        hasSource: true,
        total: 2,
        cleared: 2,
        completed: true,
      });
    });

    it('replays a cleared trap without a write, so a double-click cannot alter the record', async () => {
      const { lessonId, questionIds } = await createPublishedQuiz('Replay Cleared');
      const student = await registerAndLogin('replay');
      await submitAttempt(lessonId, questionIds, student.token, [0]);

      await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/trap-hunter/answer`)
        .set('Authorization', `Bearer ${student.token}`)
        .send({ questionId: questionIds[0], submitted: CORRECT[0] })
        .expect(201);

      const before = await prisma.lessonTaskProgress.findFirst({
        where: { userId: student.userId, task: { lessonId } },
      });

      // Now answer it WRONG. A cleared trap replays its outcome and is not
      // re-graded, so this cannot un-clear it.
      const replay = await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/trap-hunter/answer`)
        .set('Authorization', `Bearer ${student.token}`)
        .send({ questionId: questionIds[0], submitted: { optionId: 'd' } })
        .expect(201);
      expect(replay.body.isCorrect).toBe(true);

      const after = await prisma.lessonTaskProgress.findFirst({
        where: { userId: student.userId, task: { lessonId } },
      });
      expect(after?.trapHunterState).toEqual(before?.trapHunterState);
    });

    it('404s for a question that is not one of this student’s traps', async () => {
      const { lessonId, questionIds } = await createPublishedQuiz('Foreign Question');
      const student = await registerAndLogin('foreign-q');
      // Only index 0 is wrong, so index 1 is not a trap for this student.
      await submitAttempt(lessonId, questionIds, student.token, [0]);

      await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/trap-hunter/answer`)
        .set('Authorization', `Bearer ${student.token}`)
        .send({ questionId: questionIds[1], submitted: CORRECT[1] })
        .expect(404);
    });
  });

  describe('INVARIANT B — Trap Hunter never touches the quiz’s own state', () => {
    it('leaves every quiz-scoring field byte-identical across a full correction round', async () => {
      const { lessonId, questionIds } = await createPublishedQuiz('No Double Scoring');
      const student = await registerAndLogin('no-double-scoring');
      await submitAttempt(lessonId, questionIds, student.token, [0, 1, 2]);

      const before = await prisma.lessonTaskProgress.findFirst({
        where: { userId: student.userId, task: { lessonId } },
      });
      expect(before).toBeTruthy();

      // A full round including a miss, a hint and three clears — every kind
      // of write this feature performs.
      await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/trap-hunter/answer`)
        .set('Authorization', `Bearer ${student.token}`)
        .send({ questionId: questionIds[0], submitted: { optionId: 'c' } })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/trap-hunter/hint`)
        .set('Authorization', `Bearer ${student.token}`)
        .send({ questionId: questionIds[0], level: 1 })
        .expect(201);
      for (const index of [0, 1, 2]) {
        await request(app.getHttpServer())
          .post(`/lessons/${lessonId}/trap-hunter/answer`)
          .set('Authorization', `Bearer ${student.token}`)
          .send({ questionId: questionIds[index], submitted: CORRECT[index] })
          .expect(201);
      }

      const after = await prisma.lessonTaskProgress.findFirst({
        where: { userId: student.userId, task: { lessonId } },
      });

      // The seven fields that belong to the quiz. If any of these move,
      // a student can inflate a quiz result by grinding traps.
      expect(after?.score).toBe(before?.score);
      expect(after?.maxScore).toBe(before?.maxScore);
      expect(after?.attemptsCount).toBe(before?.attemptsCount);
      expect(after?.completedAt).toEqual(before?.completedAt);
      expect(after?.lastAnswers).toEqual(before?.lastAnswers);
      expect(after?.lastSubmitResult).toEqual(before?.lastSubmitResult);
      expect(after?.currentAttemptAnswers).toEqual(before?.currentAttemptAnswers);
      expect(after?.lastClientAttemptId).toBe(before?.lastClientAttemptId);

      // ...while the one field it DOES own has of course changed.
      expect(after?.trapHunterState).not.toEqual(before?.trapHunterState);
    });

    it('does not make a failed quiz look passed, however many traps are cleared', async () => {
      const { lessonId, questionIds } = await createPublishedQuiz('Still Failed');
      const student = await registerAndLogin('still-failed');
      // 1/4 = 25%, under the default 70% pass mark.
      await submitAttempt(lessonId, questionIds, student.token, [0, 1, 2]);

      for (const index of [0, 1, 2]) {
        await request(app.getHttpServer())
          .post(`/lessons/${lessonId}/trap-hunter/answer`)
          .set('Authorization', `Bearer ${student.token}`)
          .send({ questionId: questionIds[index], submitted: CORRECT[index] })
          .expect(201);
      }

      const quiz = await request(app.getHttpServer())
        .get(`/lessons/${lessonId}/quiz`)
        .set('Authorization', `Bearer ${student.token}`)
        .expect(200);
      expect(quiz.body.progress.passed).toBe(false);
      expect(quiz.body.progress.bestScorePercent).toBe(25);
    });
  });

  describe('Retaking the quiz', () => {
    it('re-derives traps from the NEW attempt and discards the old cleared flags', async () => {
      const { lessonId, questionIds } = await createPublishedQuiz('Retake Lesson');
      const student = await registerAndLogin('retake');

      await submitAttempt(lessonId, questionIds, student.token, [0]);
      await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/trap-hunter/answer`)
        .set('Authorization', `Bearer ${student.token}`)
        .send({ questionId: questionIds[0], submitted: CORRECT[0] })
        .expect(201);
      const firstRound = await getTraps(lessonId, student.token);
      expect(firstRound.body.progress.completed).toBe(true);

      // A second attempt, wrong on DIFFERENT questions.
      await submitAttempt(lessonId, questionIds, student.token, [1, 3]);

      const secondRound = await getTraps(lessonId, student.token);
      const trapIds = secondRound.body.traps.map(
        (trap: { questionId: string }) => trap.questionId,
      );
      expect(trapIds.sort()).toEqual([questionIds[1], questionIds[3]].sort());
      // Nothing carried over: the stage starts from this attempt's mistakes.
      expect(secondRound.body.progress).toEqual({
        hasSource: true,
        total: 2,
        cleared: 0,
        completed: false,
      });
    });
  });

  describe('What an uncleared trap does and does not carry', () => {
    it('carries neither correctAnswer nor explanation while sealed', async () => {
      const { lessonId, questionIds } = await createPublishedQuiz('Sealed Trap');
      const student = await registerAndLogin('sealed');
      await submitAttempt(lessonId, questionIds, student.token, [0, 1]);

      const res = await getTraps(lessonId, student.token);
      const body = JSON.stringify(res.body);
      expect(body).not.toContain('correctAnswer');
      expect(body).not.toContain('Third person singular takes -s.');
      expect(body).not.toContain('Habits are one of its core uses.');
      res.body.traps.forEach((trap: { hints: unknown[]; cleared: unknown }) => {
        expect(trap.hints).toEqual([]);
        expect(trap.cleared).toBeNull();
      });
    });

    it('carries its result once cleared, so a refresh restores what the student earned', async () => {
      const { lessonId, questionIds } = await createPublishedQuiz('Cleared Restores');
      const student = await registerAndLogin('cleared-restores');
      await submitAttempt(lessonId, questionIds, student.token, [0, 1]);
      await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/trap-hunter/answer`)
        .set('Authorization', `Bearer ${student.token}`)
        .send({ questionId: questionIds[0], submitted: CORRECT[0] })
        .expect(201);

      const res = await getTraps(lessonId, student.token);
      const cleared = res.body.traps.find(
        (trap: { questionId: string }) => trap.questionId === questionIds[0],
      );
      const sealed = res.body.traps.find(
        (trap: { questionId: string }) => trap.questionId === questionIds[1],
      );
      expect(cleared.cleared.correctAnswer).toEqual({ optionId: 'b' });
      expect(cleared.cleared.explanation).toBe('Third person singular takes -s.');
      // ...and the one still open stays sealed in the same response.
      expect(sealed.cleared).toBeNull();
      expect(sealed.hints).toEqual([]);
    });
  });

  describe('Hints', () => {
    it('unlocks one level at a time and records it across a re-GET', async () => {
      const { lessonId, questionIds } = await createPublishedQuiz('Hint Levels');
      const student = await registerAndLogin('hint-levels');
      await submitAttempt(lessonId, questionIds, student.token, [0]);

      const first = await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/trap-hunter/hint`)
        .set('Authorization', `Bearer ${student.token}`)
        .send({ questionId: questionIds[0], level: 1 })
        .expect(201);
      expect(first.body.hintLevel).toBe(1);
      expect(first.body.hintsAvailable).toBe(2);
      expect(first.body.hints).toHaveLength(1);
      expect(first.body.hints[0].payload.shape).toBe('eliminate');
      // Level 1 narrows without answering: it never strikes out the right
      // option, and never leaves only one standing.
      expect(first.body.hints[0].payload.optionIds).not.toContain('b');
      expect(first.body.hints[0].payload.optionIds.length).toBeLessThan(3);

      // Survives a reload — the student gets back what they were reading.
      const reloaded = await getTraps(lessonId, student.token);
      expect(reloaded.body.traps[0].hintLevel).toBe(1);
      expect(reloaded.body.traps[0].hints).toHaveLength(1);
      // ...and still nothing beyond it.
      expect(JSON.stringify(reloaded.body)).not.toContain(
        'Third person singular takes -s.',
      );

      const second = await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/trap-hunter/hint`)
        .set('Authorization', `Bearer ${student.token}`)
        .send({ questionId: questionIds[0], level: 2 })
        .expect(201);
      expect(second.body.hints[1].payload).toEqual({
        shape: 'explanation',
        text: 'Third person singular takes -s.',
      });
    });

    it('offers no hints at all for a question with no authored source', async () => {
      const { lessonId, questionIds } = await createPublishedQuiz('No Hint Source');
      const student = await registerAndLogin('no-hint-source');
      // Index 3 is ORDERING with three options and no explanation: its
      // Level 1 exists but Level 2 does not.
      await submitAttempt(lessonId, questionIds, student.token, [3]);

      const res = await getTraps(lessonId, student.token);
      expect(res.body.traps[0].hintsAvailable).toBe(1);

      await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/trap-hunter/hint`)
        .set('Authorization', `Bearer ${student.token}`)
        .send({ questionId: questionIds[3], level: 2 })
        .expect(400);
    });

    it('NEVER blocks or annotates a clear — a hinted correction is just a correction', async () => {
      const { lessonId, questionIds } = await createPublishedQuiz('Hint Then Clear');
      const student = await registerAndLogin('hint-then-clear');
      await submitAttempt(lessonId, questionIds, student.token, [0]);

      // Take every hint available, then answer correctly.
      await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/trap-hunter/hint`)
        .set('Authorization', `Bearer ${student.token}`)
        .send({ questionId: questionIds[0], level: 2 })
        .expect(201);

      const answer = await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/trap-hunter/answer`)
        .set('Authorization', `Bearer ${student.token}`)
        .send({ questionId: questionIds[0], submitted: CORRECT[0] })
        .expect(201);
      expect(answer.body.isCorrect).toBe(true);
      expect(answer.body.allCleared).toBe(true);

      const res = await getTraps(lessonId, student.token);
      expect(res.body.progress.completed).toBe(true);
      // Nothing anywhere in the payload marks this clear as assisted.
      expect(res.body.traps[0].cleared).not.toBeNull();
    });
  });

  describe('Access control', () => {
    it('401s without a token', async () => {
      const { lessonId } = await createPublishedQuiz('Unauthenticated');
      await request(app.getHttpServer())
        .get(`/lessons/${lessonId}/trap-hunter`)
        .expect(401);
    });

    it('404s on an unpublished lesson, the same as the quiz surface', async () => {
      const { lessonId } = await createPublishedQuiz('Unpublished Lesson');
      await prisma.lesson.update({
        where: { id: lessonId },
        data: { isPublished: false },
      });
      const student = await registerAndLogin('unpublished');
      await request(app.getHttpServer())
        .get(`/lessons/${lessonId}/trap-hunter`)
        .set('Authorization', `Bearer ${student.token}`)
        .expect(404);
    });

    it('keeps one student’s traps out of another’s', async () => {
      const { lessonId, questionIds } = await createPublishedQuiz('Per Student');
      const alice = await registerAndLogin('alice');
      const bob = await registerAndLogin('bob');

      await submitAttempt(lessonId, questionIds, alice.token, [0, 1]);
      await submitAttempt(lessonId, questionIds, bob.token, [3]);

      const aliceTraps = await getTraps(lessonId, alice.token);
      const bobTraps = await getTraps(lessonId, bob.token);
      expect(aliceTraps.body.progress.total).toBe(2);
      expect(bobTraps.body.progress.total).toBe(1);
      expect(bobTraps.body.traps[0].questionId).toBe(questionIds[3]);
    });
  });

  describe('Course-level batch progress', () => {
    it('reports one row per quiz-bearing lesson, with hasSource distinguishing blocked from perfect', async () => {
      const attempted = await createPublishedQuiz('Batch Attempted');
      const untouched = await createPublishedQuiz('Batch Untouched');
      const student = await registerAndLogin('batch');

      await submitAttempt(attempted.lessonId, attempted.questionIds, student.token, [0]);

      const res = await request(app.getHttpServer())
        .get(`/courses/${courseId}/trap-hunter-progress`)
        .set('Authorization', `Bearer ${student.token}`)
        .expect(200);

      const rows = res.body.data as {
        lessonId: string;
        hasSource: boolean;
        total: number;
        cleared: number;
      }[];
      const attemptedRow = rows.find((row) => row.lessonId === attempted.lessonId);
      const untouchedRow = rows.find((row) => row.lessonId === untouched.lessonId);

      expect(attemptedRow).toEqual({
        lessonId: attempted.lessonId,
        hasSource: true,
        total: 1,
        cleared: 0,
      });
      expect(untouchedRow).toEqual({
        lessonId: untouched.lessonId,
        hasSource: false,
        total: 0,
        cleared: 0,
      });
    });
  });
});
