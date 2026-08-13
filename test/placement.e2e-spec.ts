import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { testFixtureName } from './test-database.util';
import {
  ROADMAP_ANALYSIS_PROVIDER,
  RoadmapAnalysisError,
  RoadmapAnalysisProvider,
  RoadmapAnalysisRequest,
} from '../src/placement/roadmap/roadmap-analysis.provider';
import {
  ROADMAP_PLANNER_PROVIDER,
  RoadmapPlanningError,
  RoadmapPlannerProvider,
  RoadmapPlanningRequest,
} from '../src/placement/roadmap/roadmap-planner.provider';

/**
 * Phase 6 — a narration engine under the test's control, the same seam
 * FakePronunciationFeedback exercises in listening-shadowing.e2e-spec.ts.
 * Without this token the AI narration path could only be exercised by
 * making paid, non-deterministic calls to Gemini from CI — which in
 * practice means it would ship untested.
 *
 * `seenRequests` proves the seam actually receives what the roadmap
 * computed (goal/level/scores/phases), not just that SOME string comes back.
 */
class FakeRoadmapAnalysis implements RoadmapAnalysisProvider {
  readonly model = 'fake-roadmap-model';
  static summary = 'Đây là một lộ trình học tập được cá nhân hoá cho bạn.';
  static failWith: RoadmapAnalysisError | null = null;
  static seenRequests: RoadmapAnalysisRequest[] = [];
  static callCount = 0;

  static reset(): void {
    FakeRoadmapAnalysis.summary =
      'Đây là một lộ trình học tập được cá nhân hoá cho bạn.';
    FakeRoadmapAnalysis.failWith = null;
    FakeRoadmapAnalysis.seenRequests = [];
    FakeRoadmapAnalysis.callCount = 0;
  }

  generate(request: RoadmapAnalysisRequest) {
    FakeRoadmapAnalysis.callCount += 1;
    FakeRoadmapAnalysis.seenRequests.push(request);
    if (FakeRoadmapAnalysis.failWith) {
      return Promise.reject(FakeRoadmapAnalysis.failWith);
    }
    return Promise.resolve({ summary: FakeRoadmapAnalysis.summary });
  }
}

/**
 * Phase 4/5 — the AI PLANNING engine under the test's control, same seam
 * shape as FakeRoadmapAnalysis above. Chooses one candidate PER PILLAR
 * present in the request (mirroring the real prompt's "exactly one resource
 * per pillar" instruction) — this keeps the fake naturally satisfying
 * validate-roadmap-plan.ts's pillar-coverage rule regardless of how many
 * real, untagged library/category rows happen to exist in the shared test
 * database, without every test needing to seed all 3 pillars itself.
 * `selectResourceId`, when set, tells the fake which specific candidate to
 * choose (by id) so a test can assert the real HTTP round trip actually
 * persisted a specific AI-selected resource. `forceInvalidPlan` bypasses
 * that entirely to deliberately return a disallowed selection.
 */
class FakeRoadmapPlanner implements RoadmapPlannerProvider {
  readonly model = 'fake-planner-model';
  static selectResourceId: string | null = null;
  static forceInvalidPlan:
    | { resourceType: 'COURSE' | 'VOCAB_LIBRARY' | 'LISTENING_CATEGORY'; resourceId: string }
    | null = null;
  static overallReason = 'Lộ trình được sắp xếp phù hợp với mục tiêu của bạn.';
  static failWith: RoadmapPlanningError | null = null;
  static seenRequests: RoadmapPlanningRequest[] = [];
  static callCount = 0;

  static reset(): void {
    FakeRoadmapPlanner.selectResourceId = null;
    FakeRoadmapPlanner.forceInvalidPlan = null;
    FakeRoadmapPlanner.overallReason =
      'Lộ trình được sắp xếp phù hợp với mục tiêu của bạn.';
    FakeRoadmapPlanner.failWith = null;
    FakeRoadmapPlanner.seenRequests = [];
    FakeRoadmapPlanner.callCount = 0;
  }

  plan(request: RoadmapPlanningRequest) {
    FakeRoadmapPlanner.callCount += 1;
    FakeRoadmapPlanner.seenRequests.push(request);
    if (FakeRoadmapPlanner.failWith) {
      return Promise.reject(FakeRoadmapPlanner.failWith);
    }
    if (FakeRoadmapPlanner.forceInvalidPlan) {
      return Promise.resolve({
        phases: [{ ...FakeRoadmapPlanner.forceInvalidPlan, reason: 'Hallucinated for this test.' }],
        overallReason: FakeRoadmapPlanner.overallReason,
      });
    }

    const byPillar = new Map<string, typeof request.candidates>();
    for (const c of request.candidates) {
      const list = byPillar.get(c.pillar) ?? [];
      list.push(c);
      byPillar.set(c.pillar, list);
    }
    const phases = [...byPillar.values()].map((candidatesInPillar) => {
      // Falls back to the LOWEST sortKey, not array order — Prisma's
      // findMany has no explicit orderBy here, so array order is
      // unspecified. Fixture seeders in this file (seedPublishedCourse etc)
      // deliberately mint an extreme sortKey to win this same tiebreak,
      // matching the real deterministic algorithm's own tie-break rule
      // (roadmap-algorithm.ts's pickResource) so fixtures behave predictably
      // in both paths.
      const chosen =
        candidatesInPillar.find((c) => c.id === FakeRoadmapPlanner.selectResourceId) ??
        [...candidatesInPillar].sort((a, b) => a.sortKey - b.sortKey)[0];
      return {
        resourceType: chosen.resourceType,
        resourceId: chosen.id,
        reason: 'AI-selected for this test.',
      };
    });
    return Promise.resolve({ phases, overallReason: FakeRoadmapPlanner.overallReason });
  }
}

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
  const createdVocabLibraryIds: string[] = [];
  const createdListeningCategoryIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ROADMAP_ANALYSIS_PROVIDER)
      .useClass(FakeRoadmapAnalysis)
      .overrideProvider(ROADMAP_PLANNER_PROVIDER)
      .useClass(FakeRoadmapPlanner)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    await app.init();

    prisma = app.get(PrismaService);
    await seedMinimumBank();
  });

  beforeEach(() => {
    FakeRoadmapAnalysis.reset();
    FakeRoadmapPlanner.reset();
  });

  afterAll(async () => {
    if (createdQuestionIds.length) {
      await prisma.placementQuestion.deleteMany({
        where: { id: { in: createdQuestionIds } },
      });
    }
    if (createdCourseIds.length) {
      await prisma.course.deleteMany({
        where: { id: { in: createdCourseIds } },
      });
    }
    if (createdVocabLibraryIds.length) {
      await prisma.vocabLibrary.deleteMany({
        where: { id: { in: createdVocabLibraryIds } },
      });
    }
    if (createdListeningCategoryIds.length) {
      await prisma.listeningCategory.deleteMany({
        where: { id: { in: createdListeningCategoryIds } },
      });
    }
    if (createdUserEmails.length) {
      await prisma.user.deleteMany({
        where: { email: { in: createdUserEmails } },
      });
    }
    await app.close();
  });

  // Decremented on every seed call below, across ALL THREE resource types —
  // never reset, never reused. Guarantees each fixture's sortKey is
  // STRICTLY more extreme than every fixture seeded before it (in this run
  // AND in this file, since multiple tests below now compete in the same
  // GENERAL_ENGLISH goal pool with the same level:'A1'). Ties between two
  // fixtures with an IDENTICAL sortKey are unresolvable by pickResource
  // (roadmap-algorithm.ts) — the array order Prisma returns for equal keys
  // is unspecified — so a shared, ever-decreasing counter is what actually
  // keeps these tests deterministic, not just "ancient" on its own.
  let fixtureSortSeq = 0;

  // level: 'A1' explicitly, not left unset — pickResource only falls back
  // to the sortKey-only tiebreak when NO candidate in the pillar has a
  // level at all; the moment ANY other real or leftover resource in the
  // shared test database has a level set, an unleveled fixture is never
  // even considered, regardless of how extreme its sortKey is. Tagging A1
  // (matching the beginner-skip path's assumed level exactly) wins the
  // level-distance-0 comparison outright; the counter above then wins the
  // sortKey tiebreak among same-level competitors, including this file's
  // own other fixtures.
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
        level: 'A1',
        createdAt: new Date(946684800000 - fixtureSortSeq++), // 2000-01-01T00:00:00Z minus the counter
      },
    });
    createdCourseIds.push(course.id);
    return course;
  }

  async function seedPublishedVocabLibrary(title: string) {
    const library = await prisma.vocabLibrary.create({
      data: {
        name: testFixtureName(title),
        description: 'Roadmap e2e fixture library',
        thumbnail: 'https://example.test/thumb.png',
        isPublished: true,
        level: 'A1',
        orderIndex: -1000000 - fixtureSortSeq++,
      },
    });
    createdVocabLibraryIds.push(library.id);
    return library;
  }

  async function seedPublishedListeningCategory(title: string) {
    const category = await prisma.listeningCategory.create({
      data: {
        name: testFixtureName(title),
        nameVi: testFixtureName(title),
        isPublished: true,
        level: 'A1',
        orderIndex: -1000000 - fixtureSortSeq++,
      },
    });
    createdListeningCategoryIds.push(category.id);
    return category;
  }

  async function seedMinimumBank(): Promise<void> {
    const sections = ['GRAMMAR', 'VOCABULARY', 'LISTENING'] as const;
    const perDifficulty: Array<
      [difficulty: 'EASY' | 'MEDIUM' | 'HARD', count: number]
    > = [
      ['EASY', 3],
      ['MEDIUM', 3],
      ['HARD', 2],
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
    const accessToken = (res.body as { accessToken?: string }).accessToken;
    // Fails loudly at the registration step itself rather than silently
    // handing back `undefined` — a bug here (e.g. a label long enough to
    // push the generated email's local-part past RFC 5321's 64-character
    // limit) would otherwise surface as a confusing 401 on whatever
    // authenticated call happens to run next.
    if (!accessToken) {
      throw new Error(
        `registerStudent('${label}') did not receive an accessToken — register responded ${res.status}: ${JSON.stringify(res.body)}`,
      );
    }
    return accessToken;
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
      expect(startRes.body.questions).toHaveLength(24);
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
      // every other question unanswered. Expected: 1/8 correct per section
      // = round(12.5) = 13% each, overall 13%, estimatedLevel A1 (0-19 band,
      // LEVEL_THRESHOLDS unchanged by the multi-pillar revision).
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

      expect(submitRes.body.grammarScore).toBe(13);
      expect(submitRes.body.vocabularyScore).toBe(13);
      expect(submitRes.body.listeningScore).toBe(13);
      expect(submitRes.body.overallScore).toBe(13);
      expect(submitRes.body.estimatedLevel).toBe('A1');

      // Authoritative counts backing the rounded 13% — a client must render
      // these directly ("1 / 8 câu đúng"), never re-derive a count from the
      // rounded percentage (round(13 / 100 * 8) is a lossy round-trip in
      // general, even though it happens to recover 1 here).
      expect(submitRes.body.grammarCorrect).toBe(1);
      expect(submitRes.body.grammarTotal).toBe(8);
      expect(submitRes.body.vocabularyCorrect).toBe(1);
      expect(submitRes.body.vocabularyTotal).toBe(8);
      expect(submitRes.body.listeningCorrect).toBe(1);
      expect(submitRes.body.listeningTotal).toBe(8);

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

    it('a retake after expiry gets a genuinely fresh attempt with a fresh ~10-minute clock', async () => {
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
      const remainingMs =
        new Date(second.body.expiresAt).getTime() - Date.now();
      expect(remainingMs).toBeGreaterThan(9 * 60 * 1000);
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
      const course = await seedPublishedCourse(
        'GRAMMAR',
        'Roadmap live-join fixture',
      );
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

      const item = (
        res.body.items as Array<{
          pillar: string;
          resourceType: string;
          resourceId: string;
          resourceTitle: string;
          resourceThumbnail: string | null;
        }>
      ).find((i) => i.pillar === 'GRAMMAR');
      expect(item).toBeDefined();
      expect(item!.resourceType).toBe('COURSE');
      expect(item!.resourceId).toBe(course.id);
      expect(item!.resourceTitle).toBe(course.title);
      expect(item!.resourceThumbnail).toBe(course.thumbnail);
    });

    it('drops an item whose course is later unpublished — never serves it stale', async () => {
      // GRAMMAR: the only Course type still live for roadmap purposes under
      // the fixed pillar<->resourceType mapping (VOCABULARY/LISTENING
      // Course rows are dormant — see roadmap-algorithm.ts's header).
      const course = await seedPublishedCourse(
        'GRAMMAR',
        'Roadmap unpublish fixture',
      );
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
        (before.body.items as Array<{ resourceId: string }>).some(
          (i) => i.resourceId === course.id,
        ),
      ).toBe(true);

      await prisma.course.update({
        where: { id: course.id },
        data: { isPublished: false },
      });

      const after = await request(app.getHttpServer())
        .get('/placement/roadmap')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(
        (after.body.items as Array<{ resourceId: string }>).some(
          (i) => i.resourceId === course.id,
        ),
      ).toBe(false);

      // Restore, so this fixture's afterAll delete doesn't race a Restrict/
      // FK concern and so the row's final state on disk matches what a real
      // admin "unpublish" action would look like (nothing else depends on
      // this here, but leaving it published is the more honest end state).
      await prisma.course.update({
        where: { id: course.id },
        data: { isPublished: true },
      });
    });

    it('aiSummary is null until POST /placement/roadmap/analysis is called', async () => {
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

  describe('GET /placement/status', () => {
    it('a fresh student sees no goal, no attempt, no roadmap', async () => {
      const token = await registerStudent('status-fresh');
      const res = await request(app.getHttpServer())
        .get('/placement/status')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body).toEqual({
        onboarded: false,
        learningGoal: null,
        hasInProgressAttempt: false,
        attemptExpiresAt: null,
        hasRoadmap: false,
      });
    });

    it('reflects the chosen goal and an in-progress attempt with its expiresAt', async () => {
      const token = await registerStudent('status-inprogress');
      await setGoal(token, 'TOEIC_650');
      const startRes = await request(app.getHttpServer())
        .post('/placement/start')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      const res = await request(app.getHttpServer())
        .get('/placement/status')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.learningGoal).toBe('TOEIC_650');
      expect(res.body.hasInProgressAttempt).toBe(true);
      expect(res.body.attemptExpiresAt).toBe(startRes.body.expiresAt);
      expect(res.body.onboarded).toBe(false);
    });

    it('lazily finalizes an expired attempt when the wizard calls status — self-corrects onboarded/hasRoadmap', async () => {
      // Label kept short deliberately: registerStudent()'s email template is
      // `placement-${label}-${randomUUID()}@example.test`, and a longer
      // label here once pushed the local-part past RFC 5321's 64-character
      // limit, making @IsEmail() correctly reject the register call — the
      // resulting undefined accessToken then surfaced as a confusing 401 on
      // the FIRST authenticated call after registration, not as a register
      // failure. Keep future labels in this file short for the same reason.
      const token = await registerStudent('status-lazy');
      await setGoal(token, 'TOEIC_650');
      const startRes = await request(app.getHttpServer())
        .post('/placement/start')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      await prisma.placementAttempt.update({
        where: { id: startRes.body.attemptId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      // No GET /placement/attempt and no submit was ever called — status
      // itself is what finalizes it, and the response reflects the fresh
      // post-finalize state, not a stale pre-finalize snapshot.
      const res = await request(app.getHttpServer())
        .get('/placement/status')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.hasInProgressAttempt).toBe(false);
      expect(res.body.attemptExpiresAt).toBeNull();
      expect(res.body.onboarded).toBe(true);
      expect(res.body.hasRoadmap).toBe(true);
    });

    it('reflects onboarded/hasRoadmap after the beginner-skip path', async () => {
      const token = await registerStudent('status-beginner');
      await setGoal(token, 'GENERAL_ENGLISH');
      await request(app.getHttpServer())
        .post('/placement/start-beginner')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      const res = await request(app.getHttpServer())
        .get('/placement/status')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.onboarded).toBe(true);
      expect(res.body.hasRoadmap).toBe(true);
      expect(res.body.hasInProgressAttempt).toBe(false);
    });
  });

  describe('POST /placement/roadmap/analysis', () => {
    it('404s before onboarding — no roadmap has been generated yet', async () => {
      const token = await registerStudent('analysis-404');
      await request(app.getHttpServer())
        .post('/placement/roadmap/analysis')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('generates once on the beginner-skip path, with sectionScores omitted, and caches it', async () => {
      const token = await registerStudent('analysis-new');
      await setGoal(token, 'GENERAL_ENGLISH');
      await request(app.getHttpServer())
        .post('/placement/start-beginner')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      const first = await request(app.getHttpServer())
        .post('/placement/roadmap/analysis')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      expect(first.body.cached).toBe(false);
      expect(first.body.summary).toBe(FakeRoadmapAnalysis.summary);
      expect(first.body.model).toBe('fake-roadmap-model');
      expect(FakeRoadmapAnalysis.callCount).toBe(1);
      // The beginner-skip path never took a test — nothing to score. It DOES
      // carry a real, non-null estimatedLevel now ('A1', assumed rather than
      // measured — see Roadmap.levelSource) so the roadmap algorithm can use
      // level-aware course selection instead of blindly picking by createdAt.
      expect(FakeRoadmapAnalysis.seenRequests[0].sectionScores).toBeNull();
      expect(FakeRoadmapAnalysis.seenRequests[0].estimatedLevel).toBe('A1');
      expect(FakeRoadmapAnalysis.seenRequests[0].goal).toBe('GENERAL_ENGLISH');
      expect(FakeRoadmapAnalysis.seenRequests[0].phases.length).toBeGreaterThan(
        0,
      );

      // A second request returns the STORED answer — never a second (paid)
      // call to the engine — same discipline Shadowing's own cache-check has.
      const second = await request(app.getHttpServer())
        .post('/placement/roadmap/analysis')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      expect(second.body.cached).toBe(true);
      expect(second.body.summary).toBe(first.body.summary);
      expect(second.body.generatedAt).toBe(first.body.generatedAt);
      expect(FakeRoadmapAnalysis.callCount).toBe(1);

      // GET /placement/roadmap reflects the same cached narrative — it is
      // the same Roadmap.aiSummary column both endpoints read.
      const roadmap = await request(app.getHttpServer())
        .get('/placement/roadmap')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(roadmap.body.aiSummary).toBe(first.body.summary);
    });

    it('on the graded path, passes the real section scores through to the engine', async () => {
      const token = await registerStudent('analysis-scored');
      await setGoal(token, 'TOEIC_450');

      const startRes = await request(app.getHttpServer())
        .post('/placement/start')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      const attemptId: string = startRes.body.attemptId;
      const questionIds: string[] = startRes.body.questions.map(
        (q: { id: string }) => q.id,
      );
      const adminQuestions = await prisma.placementQuestion.findMany({
        where: { id: { in: questionIds } },
      });
      // Answer every question correctly — a clean, unambiguous 100% to
      // assert on, distinct from the '25% per section' fixture already used
      // by the scoring-lifecycle test above.
      for (const question of adminQuestions) {
        await request(app.getHttpServer())
          .post(`/placement/attempt/${attemptId}/answer`)
          .set('Authorization', `Bearer ${token}`)
          .send({
            questionId: question.id,
            submitted: buildCorrectSubmission(question),
          })
          .expect(201);
      }
      await request(app.getHttpServer())
        .post(`/placement/attempt/${attemptId}/submit`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      await request(app.getHttpServer())
        .post('/placement/roadmap/analysis')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      const seen = FakeRoadmapAnalysis.seenRequests[0];
      expect(seen.sectionScores).toEqual({
        grammar: 100,
        vocabulary: 100,
        listening: 100,
      });
      expect(seen.estimatedLevel).toBe('C1');
    });

    it('maps a provider failure to 503 and writes nothing — a retry can still succeed', async () => {
      const token = await registerStudent('analysis-fail');
      await setGoal(token, 'GENERAL_ENGLISH');
      await request(app.getHttpServer())
        .post('/placement/start-beginner')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      FakeRoadmapAnalysis.failWith = new RoadmapAnalysisError(
        'UNAVAILABLE',
        'simulated outage',
      );
      await request(app.getHttpServer())
        .post('/placement/roadmap/analysis')
        .set('Authorization', `Bearer ${token}`)
        .expect(503);

      const roadmap = await request(app.getHttpServer())
        .get('/placement/roadmap')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(roadmap.body.aiSummary).toBeNull();

      // The engine recovers; a retry with no other state change succeeds.
      FakeRoadmapAnalysis.failWith = null;
      const retry = await request(app.getHttpServer())
        .post('/placement/roadmap/analysis')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      expect(retry.body.cached).toBe(false);
    });
  });

  describe('POST /placement/roadmap/plan', () => {
    it('404s before onboarding — no roadmap has been generated yet', async () => {
      const token = await registerStudent('plan-404');
      await request(app.getHttpServer())
        .post('/placement/roadmap/plan')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('a valid AI selection is persisted (items AND aiSummary) and reflected in GET /placement/roadmap', async () => {
      const course = await seedPublishedCourse('GRAMMAR', 'Plan e2e fixture');
      const token = await registerStudent('plan-success');
      await setGoal(token, 'GENERAL_ENGLISH');
      await request(app.getHttpServer())
        .post('/placement/start-beginner')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      FakeRoadmapPlanner.selectResourceId = course.id;
      const res = await request(app.getHttpServer())
        .post('/placement/roadmap/plan')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      expect(res.body.aiPlanningUsed).toBe(true);
      expect(
        (res.body.items as Array<{ resourceType: string; resourceId: string }>).some(
          (i) => i.resourceType === 'COURSE' && i.resourceId === course.id,
        ),
      ).toBe(true);
      expect(res.body.aiSummary).toBe(FakeRoadmapPlanner.overallReason);
      expect(FakeRoadmapPlanner.callCount).toBe(1);
      // Only real, already-filtered candidates ever reach the provider.
      expect(
        FakeRoadmapPlanner.seenRequests[0].candidates.some(
          (c) => c.id === course.id,
        ),
      ).toBe(true);

      const roadmap = await request(app.getHttpServer())
        .get('/placement/roadmap')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(roadmap.body.aiPlanningUsed).toBe(true);
      expect(roadmap.body.aiSummary).toBe(FakeRoadmapPlanner.overallReason);

      // Idempotency: calling /plan again for the SAME generation must not
      // re-call the (paid) provider.
      const again = await request(app.getHttpServer())
        .post('/placement/roadmap/plan')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      expect(FakeRoadmapPlanner.callCount).toBe(1);
      expect(again.body.aiSummary).toBe(FakeRoadmapPlanner.overallReason);
    });

    it('falls back to the deterministic roadmap — still 201, never an error — when the AI returns a disallowed resourceId', async () => {
      const token = await registerStudent('plan-invalid');
      await setGoal(token, 'GENERAL_ENGLISH');
      await request(app.getHttpServer())
        .post('/placement/start-beginner')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      const before = await request(app.getHttpServer())
        .get('/placement/roadmap')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      FakeRoadmapPlanner.forceInvalidPlan = {
        resourceType: 'COURSE',
        resourceId: 'not-a-real-course-id',
      };
      const res = await request(app.getHttpServer())
        .post('/placement/roadmap/plan')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      expect(res.body.aiPlanningUsed).toBe(false);
      expect(res.body.items).toEqual(before.body.items);
      expect(res.body.aiSummary).toBeNull();
    });

    it('falls back to the deterministic roadmap — still 201, never an error — when the provider is unavailable', async () => {
      const token = await registerStudent('plan-unavailable');
      await setGoal(token, 'GENERAL_ENGLISH');
      await request(app.getHttpServer())
        .post('/placement/start-beginner')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      FakeRoadmapPlanner.failWith = new RoadmapPlanningError(
        'UNAVAILABLE',
        'simulated outage',
      );
      const res = await request(app.getHttpServer())
        .post('/placement/roadmap/plan')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      expect(res.body.aiPlanningUsed).toBe(false);
    });

    it('a heterogeneous 3-pillar candidate seed (Course + VocabLibrary + ListeningCategory) produces one AI-selected phase per pillar', async () => {
      const course = await seedPublishedCourse('GRAMMAR', 'Plan multi-pillar course');
      const library = await seedPublishedVocabLibrary('Plan multi-pillar library');
      const category = await seedPublishedListeningCategory('Plan multi-pillar category');
      const token = await registerStudent('plan-multipillar');
      await setGoal(token, 'GENERAL_ENGLISH');
      await request(app.getHttpServer())
        .post('/placement/start-beginner')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      const res = await request(app.getHttpServer())
        .post('/placement/roadmap/plan')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      expect(res.body.aiPlanningUsed).toBe(true);
      const items = res.body.items as Array<{
        pillar: string;
        resourceType: string;
        resourceId: string;
      }>;
      expect(items.find((i) => i.pillar === 'GRAMMAR')).toMatchObject({
        resourceType: 'COURSE',
        resourceId: course.id,
      });
      expect(items.find((i) => i.pillar === 'VOCABULARY')).toMatchObject({
        resourceType: 'VOCAB_LIBRARY',
        resourceId: library.id,
      });
      expect(items.find((i) => i.pillar === 'LISTENING')).toMatchObject({
        resourceType: 'LISTENING_CATEGORY',
        resourceId: category.id,
      });
    });
  });

  describe('retake regenerates the roadmap (Phase 7)', () => {
    it('start-beginner called again clears a stale cached aiSummary', async () => {
      const token = await registerStudent('retake-beginner');
      await setGoal(token, 'GENERAL_ENGLISH');
      await request(app.getHttpServer())
        .post('/placement/start-beginner')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      await request(app.getHttpServer())
        .post('/placement/roadmap/analysis')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      const before = await request(app.getHttpServer())
        .get('/placement/roadmap')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(before.body.aiSummary).not.toBeNull();

      // The retake: same endpoint, called again on an already-onboarded
      // account. onboardedAt must not move (already set); the Roadmap row
      // DOES regenerate, and any narrative cached against the OLD roadmap
      // must not survive to describe the new one.
      const retake = await request(app.getHttpServer())
        .post('/placement/start-beginner')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      expect(retake.body.roadmapGenerated).toBe(true);

      const after = await request(app.getHttpServer())
        .get('/placement/roadmap')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(after.body.aiSummary).toBeNull();

      const me = await request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(me.body.onboarded).toBe(true);
    });

    it('a full retest (POST start -> submit) on an already-onboarded account clears a stale cached aiSummary', async () => {
      const token = await registerStudent('retake-full');
      await setGoal(token, 'GENERAL_ENGLISH');
      await request(app.getHttpServer())
        .post('/placement/start-beginner')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      await request(app.getHttpServer())
        .post('/placement/roadmap/analysis')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      const startRes = await request(app.getHttpServer())
        .post('/placement/start')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      await request(app.getHttpServer())
        .post(`/placement/attempt/${startRes.body.attemptId}/submit`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      const after = await request(app.getHttpServer())
        .get('/placement/roadmap')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(after.body.aiSummary).toBeNull();
      // A fresh, real placementAttemptId — proof this is the NEW test's
      // roadmap, not a leftover from the beginner-skip path.
      expect(after.body.placementAttemptId).toBe(startRes.body.attemptId);
    });
  });
});
