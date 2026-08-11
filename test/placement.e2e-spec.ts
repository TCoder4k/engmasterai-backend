import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { testFixtureName } from './test-database.util';

// Personalized Onboarding & Placement Test, Phase 3 — the student-facing
// flow (goal, start-beginner, start/attempt/answer/submit, finalizeIfDue,
// timer enforcement). Same registration boilerplate as
// placement-question.e2e-spec.ts.
//
// Sampling draws from EVERY published PlacementQuestion in the shared test
// database, not just this file's own fixtures (other suites, run in
// parallel, may also publish rows) — see the project's documented
// shared-test-database worker contention. Tests here therefore never assume
// which concrete questions get sampled: correct answers are always read
// back from Prisma directly (buildCorrectSubmission) rather than hardcoded,
// and this file's own seedMinimumBank() guarantees sampling can never fail
// for lack of published content, regardless of what else is running.
describe('Placement test flow (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const createdUserEmails: string[] = [];
  const createdQuestionIds: string[] = [];
  const createdCourseIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    await app.init();

    prisma = app.get(PrismaService);
    await seedMinimumBank();
  });

  afterAll(async () => {
    if (createdQuestionIds.length) {
      await prisma.placementQuestion.deleteMany({
        where: { id: { in: createdQuestionIds } },
      });
    }
    if (createdCourseIds.length) {
      await prisma.course.deleteMany({ where: { id: { in: createdCourseIds } } });
    }
    if (createdUserEmails.length) {
      await prisma.user.deleteMany({ where: { email: { in: createdUserEmails } } });
    }
    await app.close();
  });

  // An artificially ancient createdAt so this fixture always wins
  // generateRoadmap's "earliest-authored" tiebreak (used on the beginner-
  // skip path) regardless of what other suites publish concurrently in the
  // shared test database — without this, a course from another suite could
  // legitimately be picked instead and these tests would be flaky.
  async function seedPublishedCourse(
    type: 'GRAMMAR' | 'VOCABULARY' | 'LISTENING',
    title: string,
  ) {
    const course = await prisma.course.create({
      data: {
        title: testFixtureName(title),
        type,
        description: 'Roadmap e2e fixture course',
        thumbnail: 'https://example.test/thumb.png',
        isPublished: true,
        createdAt: new Date('2000-01-01T00:00:00Z'),
      },
    });
    createdCourseIds.push(course.id);
    return course;
  }

  async function seedMinimumBank(): Promise<void> {
    const sections = ['GRAMMAR', 'VOCABULARY', 'LISTENING'] as const;
    const perDifficulty: Array<[difficulty: 'EASY' | 'MEDIUM' | 'HARD', count: number]> = [
      ['EASY', 2],
      ['MEDIUM', 1],
      ['HARD', 1],
    ];
    for (const section of sections) {
      for (const [difficulty, count] of perDifficulty) {
        for (let i = 0; i < count; i++) {
          const q = await prisma.placementQuestion.create({
            data: {
              section,
              type: 'TRUE_FALSE',
              difficulty,
              content: testFixtureName(`${section} ${difficulty} #${i}`),
              correctAnswer: { value: true },
              isPublished: true,
            },
          });
          createdQuestionIds.push(q.id);
        }
      }
    }
  }

  async function registerStudent(label: string): Promise<string> {
    const email = `placement-${label}-${randomUUID()}@example.test`;
    createdUserEmails.push(email);
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: `Placement ${label}`, email, password: 'password123' });
    return (res.body as { accessToken: string }).accessToken;
  }

  async function setGoal(token: string, goal: string): Promise<void> {
    await request(app.getHttpServer())
      .put('/placement/goal')
      .set('Authorization', `Bearer ${token}`)
      .send({ goal })
      .expect(200);
  }

  // Reads the ADMIN-truth correctAnswer directly via Prisma (never available
  // in a student-facing response — Invariant 9) and builds a submission that
  // will grade correct for that question's own type, whatever it is.
  function buildCorrectSubmission(question: {
    type: string;
    correctAnswer: unknown;
  }): unknown {
    const correctAnswer = question.correctAnswer as Record<string, unknown>;
    switch (question.type) {
      case 'MULTIPLE_CHOICE':
        return { optionId: correctAnswer.optionId };
      case 'TRUE_FALSE':
        return { value: correctAnswer.value };
      case 'FILL_BLANK':
        return { text: (correctAnswer.accepted as string[])[0] };
      case 'ORDERING':
        return { orderedOptionIds: correctAnswer.orderedOptionIds };
      default:
        throw new Error(`Unexpected question type: ${question.type}`);
    }
  }

  describe('goal + beginner (skip-test) path', () => {
    it('rejects start-beginner with no goal set', async () => {
      const token = await registerStudent('nogoal');
      await request(app.getHttpServer())
        .post('/placement/start-beginner')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });

    it('sets a goal, then start-beginner onboards immediately with no attempt', async () => {
      const token = await registerStudent('beginner');
      await setGoal(token, 'GENERAL_ENGLISH');

      const res = await request(app.getHttpServer())
        .post('/placement/start-beginner')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      expect(res.body.roadmapGenerated).toBe(true);

      const me = await request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(me.body.onboarded).toBe(true);
    });
  });

  describe('full test lifecycle + scoring', () => {
    it('starts, answers a known mix of correct/unanswered, submits, and the score matches exactly', async () => {
      const token = await registerStudent('scoring');
      await setGoal(token, 'TOEIC_450');

      const startRes = await request(app.getHttpServer())
        .post('/placement/start')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      expect(startRes.body.questions).toHaveLength(12);
      const attemptId: string = startRes.body.attemptId;
      const questionIds: string[] = startRes.body.questions.map(
        (q: { id: string }) => q.id,
      );

      const adminQuestions = await prisma.placementQuestion.findMany({
        where: { id: { in: questionIds } },
      });
      const bySection: Record<string, typeof adminQuestions> = {
        GRAMMAR: [],
        VOCABULARY: [],
        LISTENING: [],
      };
      adminQuestions.forEach((q) => bySection[q.section].push(q));

      // Answer exactly the FIRST question of each section correctly; leave
      // every other question unanswered. Expected: 1/4 correct per section
      // = 25% each, overall 25%, estimatedLevel A2 (20-39 band).
      for (const section of Object.keys(bySection)) {
        const question = bySection[section][0];
        await request(app.getHttpServer())
          .post(`/placement/attempt/${attemptId}/answer`)
          .set('Authorization', `Bearer ${token}`)
          .send({
            questionId: question.id,
            submitted: buildCorrectSubmission(question),
          })
          .expect(201);
      }

      const submitRes = await request(app.getHttpServer())
        .post(`/placement/attempt/${attemptId}/submit`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      expect(submitRes.body.grammarScore).toBe(25);
      expect(submitRes.body.vocabularyScore).toBe(25);
      expect(submitRes.body.listeningScore).toBe(25);
      expect(submitRes.body.overallScore).toBe(25);
      expect(submitRes.body.estimatedLevel).toBe('A2');

      const me = await request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(me.body.onboarded).toBe(true);

      // Replay: resubmitting returns the SAME stored result, not a re-grade.
      const replay = await request(app.getHttpServer())
        .post(`/placement/attempt/${attemptId}/submit`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      expect(replay.body).toEqual(submitRes.body);

      // GET no longer finds an in-progress attempt once completed.
      await request(app.getHttpServer())
        .get('/placement/attempt')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('rejects an answer for a question that is not part of the attempt', async () => {
      const token = await registerStudent('wrongquestion');
      await setGoal(token, 'TOEIC_450');
      const startRes = await request(app.getHttpServer())
        .post('/placement/start')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      await request(app.getHttpServer())
        .post(`/placement/attempt/${startRes.body.attemptId}/answer`)
        .set('Authorization', `Bearer ${token}`)
        .send({ questionId: randomUUID(), submitted: { value: true } })
        .expect(400);
    });
  });

  describe('timer enforcement', () => {
    it('refresh never resets the timer: a repeated start returns the SAME attempt and expiresAt', async () => {
      const token = await registerStudent('refresh');
      await setGoal(token, 'FOUNDATION');

      const first = await request(app.getHttpServer())
        .post('/placement/start')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      const second = await request(app.getHttpServer())
        .post('/placement/start')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      expect(second.body.attemptId).toBe(first.body.attemptId);
      expect(second.body.expiresAt).toBe(first.body.expiresAt);
    });

    it('rejects an answer after expiresAt with no PlacementAnswer row written', async () => {
      const token = await registerStudent('expired-answer');
      await setGoal(token, 'FOUNDATION');
      const startRes = await request(app.getHttpServer())
        .post('/placement/start')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      const attemptId: string = startRes.body.attemptId;
      const questionId: string = startRes.body.questions[0].id;

      await prisma.placementAttempt.update({
        where: { id: attemptId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await request(app.getHttpServer())
        .post(`/placement/attempt/${attemptId}/answer`)
        .set('Authorization', `Bearer ${token}`)
        .send({ questionId, submitted: { value: true } })
        .expect(409);

      const row = await prisma.placementAnswer.findUnique({
        where: { attemptId_questionId: { attemptId, questionId } },
      });
      expect(row).toBeNull();
    });

    it('a GET on an abandoned, never-submitted, expired attempt finalizes it lazily', async () => {
      const token = await registerStudent('lazy-finalize');
      await setGoal(token, 'FOUNDATION');
      const startRes = await request(app.getHttpServer())
        .post('/placement/start')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      const attemptId: string = startRes.body.attemptId;

      await prisma.placementAttempt.update({
        where: { id: attemptId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      // No submit call was ever made — the GET itself must finalize it.
      await request(app.getHttpServer())
        .get('/placement/attempt')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);

      const row = await prisma.placementAttempt.findUnique({
        where: { id: attemptId },
      });
      expect(row!.completedAt).not.toBeNull();
      expect(row!.overallScore).not.toBeNull();
      // Every question was left unanswered -> 0 on every section.
      expect(row!.overallScore).toBe(0);

      const me = await request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(me.body.onboarded).toBe(true);
    });

    it('a retake after expiry gets a genuinely fresh attempt with a fresh ~5-minute clock', async () => {
      const token = await registerStudent('retake');
      await setGoal(token, 'FOUNDATION');
      const first = await request(app.getHttpServer())
        .post('/placement/start')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      await prisma.placementAttempt.update({
        where: { id: first.body.attemptId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const second = await request(app.getHttpServer())
        .post('/placement/start')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      expect(second.body.attemptId).not.toBe(first.body.attemptId);
      const remainingMs = new Date(second.body.expiresAt).getTime() - Date.now();
      expect(remainingMs).toBeGreaterThan(4 * 60 * 1000);
    });
  });

  describe('rate limiting', () => {
    it('two full attempts worth of requests inside one window all succeed (no 429)', async () => {
      const token = await registerStudent('ratelimit');
      await setGoal(token, 'FOUNDATION');

      for (let i = 0; i < 2; i++) {
        const startRes = await request(app.getHttpServer())
          .post('/placement/start')
          .set('Authorization', `Bearer ${token}`)
          .expect(201);
        const attemptId: string = startRes.body.attemptId;

        for (const q of startRes.body.questions) {
          await request(app.getHttpServer())
            .post(`/placement/attempt/${attemptId}/answer`)
            .set('Authorization', `Bearer ${token}`)
            .send({ questionId: q.id, submitted: { value: true } })
            .expect(201);
        }

        await request(app.getHttpServer())
          .post(`/placement/attempt/${attemptId}/submit`)
          .set('Authorization', `Bearer ${token}`)
          .expect(201);
      }
    });
  });

  describe('GET /placement/roadmap', () => {
    it('404s before onboarding — no roadmap has been generated yet', async () => {
      const token = await registerStudent('roadmap-404');
      await request(app.getHttpServer())
        .get('/placement/roadmap')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('reflects the LIVE course title/thumbnail, not a stored snapshot', async () => {
      const course = await seedPublishedCourse('GRAMMAR', 'Roadmap live-join fixture');
      const token = await registerStudent('roadmap-live');
      await setGoal(token, 'GENERAL_ENGLISH');
      await request(app.getHttpServer())
        .post('/placement/start-beginner')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      const res = await request(app.getHttpServer())
        .get('/placement/roadmap')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const item = (res.body.items as Array<{ courseType: string; courseId: string; courseTitle: string; courseThumbnail: string | null }>)
        .find((i) => i.courseType === 'GRAMMAR');
      expect(item).toBeDefined();
      expect(item!.courseId).toBe(course.id);
      expect(item!.courseTitle).toBe(course.title);
      expect(item!.courseThumbnail).toBe(course.thumbnail);
    });

    it('drops an item whose course is later unpublished — never serves it stale', async () => {
      const course = await seedPublishedCourse('LISTENING', 'Roadmap unpublish fixture');
      const token = await registerStudent('roadmap-unpublish');
      await setGoal(token, 'GENERAL_ENGLISH');
      await request(app.getHttpServer())
        .post('/placement/start-beginner')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      const before = await request(app.getHttpServer())
        .get('/placement/roadmap')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(
        (before.body.items as Array<{ courseId: string }>).some((i) => i.courseId === course.id),
      ).toBe(true);

      await prisma.course.update({ where: { id: course.id }, data: { isPublished: false } });

      const after = await request(app.getHttpServer())
        .get('/placement/roadmap')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(
        (after.body.items as Array<{ courseId: string }>).some((i) => i.courseId === course.id),
      ).toBe(false);

      // Restore, so this fixture's afterAll delete doesn't race a Restrict/
      // FK concern and so the row's final state on disk matches what a real
      // admin "unpublish" action would look like (nothing else depends on
      // this here, but leaving it published is the more honest end state).
      await prisma.course.update({ where: { id: course.id }, data: { isPublished: true } });
    });

    it('aiSummary is null until Phase 6 populates it', async () => {
      const token = await registerStudent('roadmap-aisummary');
      await setGoal(token, 'GENERAL_ENGLISH');
      await request(app.getHttpServer())
        .post('/placement/start-beginner')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      const res = await request(app.getHttpServer())
        .get('/placement/roadmap')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.aiSummary).toBeNull();
      expect(res.body.placementAttemptId).toBeNull(); // beginner-skip path, no test taken
    });
  });
});
