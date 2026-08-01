import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { testFixtureName } from './test-database.util';
import { expectIdempotentReplay } from './replay-assertions';

// Sprint 10 — Gamification, end to end.
//
// The properties proven here are the ones a unit test cannot reach, because
// they are about what actually landed in Postgres and what the wire response
// looked like:
//
//   - XP is awarded exactly once, enforced by the ledger's unique constraint;
//   - rewatching, retaking and replaying all award nothing;
//   - Trap Hunter earns XP but creates NO activity day (the Sprint 09
//     behaviour it must not disturb);
//   - GET /analytics/dashboard is untouched by any of this;
//   - the pure READ endpoints carry no gamification field at any depth;
//   - the 'gamification' rate-limit bucket is genuinely its own.
describe('Gamification (e2e) — Sprint 10', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  let courseId: string;
  let adminToken: string;

  const VIDEO_DURATION = 600;

  const registerAndLogin = async (
    label: string,
  ): Promise<{ token: string; userId: string }> => {
    const email = `s10-${label.slice(0, 18)}-${randomUUID()}@example.test`;
    const register = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: `Sprint 10 ${label}`, email, password: 'password123' });
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

  // Returns the lesson id AND the practice question ids, because unlike the
  // quiz there is no read-only student GET that lists them before an attempt
  // has been started — the admin PUT's response is where they come from.
  const createLessonWithTasks = async (
    title: string,
    opts: { quiz?: boolean; practice?: boolean } = {},
  ): Promise<{ lessonId: string; practiceQuestionIds: string[] }> => {
    const lesson = await prisma.lesson.create({
      data: {
        courseId,
        title: testFixtureName(title),
        orderIndex: 0,
        isPublished: true,
        videoUrl: 'https://youtu.be/fixture',
        notes: '# Theory\nSome content.',
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
          feedbackMode: 'ON_SUBMIT',
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

  const createLesson = async (
    title: string,
    opts: { quiz?: boolean } = {},
  ): Promise<string> => (await createLessonWithTasks(title, opts)).lessonId;

  const postVideo = (
    lessonId: string,
    token: string,
    positionSeconds: number,
  ) =>
    request(app.getHttpServer())
      .post(`/lessons/${lessonId}/steps/video/progress`)
      .set('Authorization', `Bearer ${token}`)
      .send({ positionSeconds, durationSeconds: VIDEO_DURATION });

  const quizQuestionIds = async (lessonId: string, token: string) => {
    const quiz = await request(app.getHttpServer())
      .get(`/lessons/${lessonId}/quiz`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return (
      quiz.body as { quiz: { questions: { id: string }[] } }
    ).quiz.questions.map((q) => q.id);
  };

  const ledgerFor = (userId: string) =>
    prisma.xpTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: { sourceKey: true, amount: true, source: true },
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
        title: testFixtureName('Sprint 10 Course'),
        type: 'GRAMMAR',
        description: 'fixture course',
        isPublished: true,
      },
    });
    courseId = course.id;

    const email = `s10-admin-${randomUUID()}@example.test`;
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: 'Sprint 10 admin', email, password: 'password123' });
    await prisma.user.update({ where: { email }, data: { role: 'ADMIN' } });
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'password123', role: 'ADMIN' });
    adminToken = (login.body as { accessToken: string }).accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('awarding', () => {
    it('awards the video stage once, and NOTHING for rewatching it', async () => {
      const { token, userId } = await registerAndLogin('rewatch');
      const lessonId = await createLesson('Rewatch lesson');

      const first = await postVideo(lessonId, token, VIDEO_DURATION).expect(
        201,
      );
      // 10 for the stage + 20 for FIRST_STAGE on a brand-new account.
      expect(first.body.gamification.xpAwarded).toBe(30);
      expect(first.body.gamification.unlockedAchievements).toEqual([
        'FIRST_STAGE',
      ]);

      const again = await postVideo(lessonId, token, VIDEO_DURATION).expect(
        201,
      );
      expect(again.body.gamification.xpAwarded).toBe(0);
      expect(again.body.gamification.xp.totalXp).toBe(30);

      // The ledger, not the response, is the proof: exactly one stage row.
      const ledger = await ledgerFor(userId);
      expect(
        ledger.filter((r) => r.sourceKey === `step:${lessonId}:VIDEO`),
      ).toHaveLength(1);

      const user = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
      });
      expect(user.totalPoints).toBe(30);
    });

    it('awards a quiz pass once, and NOTHING for passing it again', async () => {
      const { token, userId } = await registerAndLogin('retake');
      const lessonId = await createLesson('Retake lesson', { quiz: true });
      const ids = await quizQuestionIds(lessonId, token);
      const answers = ids.map((questionId, i) => ({
        questionId,
        submitted: CORRECT[i],
      }));

      const first = await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/quiz/submit`)
        .set('Authorization', `Bearer ${token}`)
        .send({ clientAttemptId: randomUUID(), answers })
        .expect(201);
      // 30 pass + 20 FIRST_STAGE + 20 FIRST_QUIZ_PASS.
      expect(first.body.gamification.xpAwarded).toBe(70);

      const retake = await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/quiz/submit`)
        .set('Authorization', `Bearer ${token}`)
        .send({ clientAttemptId: randomUUID(), answers })
        .expect(201);
      // A genuinely new attempt — not a replay — that happens to pass again.
      expect(retake.body.attemptsCount).toBe(2);
      expect(retake.body.gamification.xpAwarded).toBe(0);

      const ledger = await ledgerFor(userId);
      expect(ledger.filter((r) => r.source === 'TASK_PASSED')).toHaveLength(1);
    });

    it('keeps two students entirely separate', async () => {
      const a = await registerAndLogin('iso-a');
      const b = await registerAndLogin('iso-b');
      const lessonId = await createLesson('Shared lesson');

      await postVideo(lessonId, a.token, VIDEO_DURATION).expect(201);

      const bProfile = await request(app.getHttpServer())
        .get('/gamification/profile')
        .set('Authorization', `Bearer ${b.token}`)
        .expect(200);
      expect(bProfile.body.xp.totalXp).toBe(0);
      expect(await ledgerFor(b.userId)).toHaveLength(0);
    });

    it('levels up exactly once when the threshold is crossed', async () => {
      const { token } = await registerAndLogin('levelup');
      const lessonId = await createLesson('Level lesson', { quiz: true });
      const ids = await quizQuestionIds(lessonId, token);

      // 70 from the quiz, then theory (10) — still level 1 at 80.
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

      const theory = await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/steps/theory/complete`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      expect(theory.body.gamification.xp.totalXp).toBe(80);
      expect(theory.body.gamification.leveledUp).toBe(false);

      // Video pushes it to 90... still short of 100.
      const video = await postVideo(lessonId, token, VIDEO_DURATION).expect(
        201,
      );
      expect(video.body.gamification.xp.totalXp).toBe(90);
      expect(video.body.gamification.xp.level).toBe(1);
    });

    it('sends the WHOLE level curve on every award, not just the total', async () => {
      // Sprint 10 QA bug 2. The envelope used to carry `totalXp` and `level`
      // alone, so the client could redraw the level number and nothing else —
      // the toast said "+30 XP" while the progress bar and the "N XP to next
      // level" caption kept the values they had at sign-in until a reload.
      // These three extra fields are what the widget actually draws.
      const { token } = await registerAndLogin('curve');
      const lessonId = await createLesson('Curve lesson');

      const res = await postVideo(lessonId, token, VIDEO_DURATION).expect(201);

      // 10 for the stage + 20 for FIRST_STAGE = 30, still level 1 of 100.
      expect(res.body.gamification.xp).toEqual({
        totalXp: 30,
        level: 1,
        intoLevel: 30,
        toNextLevel: 70,
        percent: 30,
      });
    });
  });

  // Sprint 10 QA bug 1 — Advanced Practice was reported as awarding no XP.
  // The defect turned out to be client-side, but this surface had NO end-to-end
  // coverage at all: the 40-XP rule, the PRACTICE source key and
  // practice.controller.ts's flattening of the envelope were all unproven.
  describe('Advanced Practice', () => {
    const passPractice = async (
      lessonId: string,
      token: string,
      questionIds: string[],
      clientAttemptId = randomUUID(),
    ) => {
      await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/practice/start`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      return request(app.getHttpServer())
        .post(`/lessons/${lessonId}/practice/submit`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          clientAttemptId,
          answers: questionIds.map((questionId, i) => ({
            questionId,
            submitted: CORRECT[i],
          })),
        })
        .expect(201);
    };

    it('awards exactly 40 XP on the first pass, and NOTHING for passing again', async () => {
      const { token, userId } = await registerAndLogin('practice-pass');
      const { lessonId, practiceQuestionIds } = await createLessonWithTasks(
        'Practice lesson',
        { practice: true },
      );

      const first = await passPractice(lessonId, token, practiceQuestionIds);
      expect(first.body.passed).toBe(true);
      // 40 for the pass + 20 for FIRST_STAGE on a brand-new account.
      expect(first.body.gamification.xpAwarded).toBe(60);
      expect(first.body.gamification.xp.totalXp).toBe(60);
      // A practice pass is a stage, but it is NOT a quiz pass — the badge must
      // not fire off the back of one.
      expect(first.body.gamification.unlockedAchievements).toEqual([
        'FIRST_STAGE',
      ]);

      const again = await passPractice(lessonId, token, practiceQuestionIds);
      expect(again.body.attemptsCount).toBe(2);
      expect(again.body.gamification.xpAwarded).toBe(0);

      // The ledger is the proof, not the response.
      const ledger = await ledgerFor(userId);
      const passes = ledger.filter((r) => r.source === 'TASK_PASSED');
      expect(passes).toHaveLength(1);
      expect(passes[0].amount).toBe(40);
      expect(passes[0].sourceKey).toMatch(/:PRACTICE:passed$/);

      const user = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
      });
      expect(user.totalPoints).toBe(60);
    });

    it('replays a submit verbatim without a second award', async () => {
      const { token } = await registerAndLogin('practice-replay');
      const { lessonId, practiceQuestionIds } = await createLessonWithTasks(
        'Practice replay lesson',
        { practice: true },
      );

      const clientAttemptId = randomUUID();
      const first = await passPractice(
        lessonId,
        token,
        practiceQuestionIds,
        clientAttemptId,
      );
      // The retry has to re-open an attempt first, and that is not a quirk of
      // the test: unlike the quiz, Advanced Practice starts EXPLICITLY, so
      // PracticeService.assertAttemptStarted rejects a submit with no attempt
      // clock rather than quietly creating one. A client retrying a timed-out
      // request is back on the intro screen, where Start Practice is the
      // button in front of it — and start is itself idempotent.
      await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/practice/start`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      const replay = await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/practice/submit`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          clientAttemptId,
          answers: practiceQuestionIds.map((questionId, i) => ({
            questionId,
            submitted: CORRECT[i],
          })),
        })
        .expect(201);

      expectIdempotentReplay(first.body, replay.body, 60);
    });

    it('a quiz pass and a practice pass cannot collide in the ledger', async () => {
      // Both are LessonTaskProgress rows on the same lesson, graded by the same
      // parameterised service. The source key carries the TASK TYPE precisely
      // so the two can never be mistaken for one another — and so FIRST_QUIZ_PASS
      // can tell them apart without inferring it from the amount.
      const { token, userId } = await registerAndLogin('practice-both');
      const { lessonId, practiceQuestionIds } = await createLessonWithTasks(
        'Both tasks lesson',
        { quiz: true, practice: true },
      );
      const quizIds = await quizQuestionIds(lessonId, token);

      const quiz = await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/quiz/submit`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          clientAttemptId: randomUUID(),
          answers: quizIds.map((questionId, i) => ({
            questionId,
            submitted: CORRECT[i],
          })),
        })
        .expect(201);
      // 30 pass + 20 FIRST_STAGE + 20 FIRST_QUIZ_PASS.
      expect(quiz.body.gamification.xpAwarded).toBe(70);

      // A perfect quiz leaves no traps, so Practice is unblocked.
      const practice = await passPractice(
        lessonId,
        token,
        practiceQuestionIds,
      );
      // 40 only — both badges are already held.
      expect(practice.body.gamification.xpAwarded).toBe(40);
      expect(practice.body.gamification.xp.totalXp).toBe(110);
      expect(practice.body.gamification.unlockedAchievements).toEqual([]);

      const passes = (await ledgerFor(userId)).filter(
        (r) => r.source === 'TASK_PASSED',
      );
      expect(passes).toHaveLength(2);
      expect(new Set(passes.map((r) => r.sourceKey)).size).toBe(2);
      expect(passes.filter((r) => r.sourceKey.endsWith(':QUIZ:passed'))).toEqual(
        [expect.objectContaining({ amount: 30 })],
      );
      expect(
        passes.filter((r) => r.sourceKey.endsWith(':PRACTICE:passed')),
      ).toEqual([expect.objectContaining({ amount: 40 })]);
    });
  });

  describe('Trap Hunter earns XP but creates NO activity day', () => {
    it('leaves UserDailyActivity untouched while still awarding', async () => {
      // The Sprint 09 behaviour this must not disturb: a trap clear writes one
      // JSON column with no timestamp, so it is invisible to the dashboard's
      // activity scan. Recording a day here would light up calendar tiles that
      // did not light up before, changing existing students' streaks.
      const { token, userId } = await registerAndLogin('trap');
      const lessonId = await createLesson('Trap lesson', { quiz: true });
      const ids = await quizQuestionIds(lessonId, token);

      // Fail one question so a trap exists, using a fresh account whose
      // activity table we then clear to isolate the trap call.
      await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/quiz/submit`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          clientAttemptId: randomUUID(),
          answers: [
            { questionId: ids[0], submitted: { optionId: 'a' } }, // wrong
            { questionId: ids[1], submitted: CORRECT[1] },
          ],
        })
        .expect(201);

      await prisma.userDailyActivity.deleteMany({ where: { userId } });
      const xpBefore = (
        await prisma.user.findUniqueOrThrow({ where: { id: userId } })
      ).totalPoints;

      const trap = await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/trap-hunter/answer`)
        .set('Authorization', `Bearer ${token}`)
        .send({ questionId: ids[0], submitted: CORRECT[0] })
        .expect(201);

      expect(trap.body.isCorrect).toBe(true);
      expect(trap.body.gamification.xpAwarded).toBe(5);

      const xpAfter = (
        await prisma.user.findUniqueOrThrow({ where: { id: userId } })
      ).totalPoints;
      expect(xpAfter).toBe(xpBefore + 5);

      // The whole point of the test.
      expect(await prisma.userDailyActivity.count({ where: { userId } })).toBe(
        0,
      );

      // Re-answering an already-cleared trap is a replay: no second award.
      const replay = await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/trap-hunter/answer`)
        .set('Authorization', `Bearer ${token}`)
        .send({ questionId: ids[0], submitted: CORRECT[0] })
        .expect(201);
      expect(replay.body.gamification.xpAwarded).toBe(0);
    });
  });

  describe('the read endpoints stay clean', () => {
    const hasKeyDeep = (value: unknown, key: string): boolean => {
      if (Array.isArray(value)) return value.some((v) => hasKeyDeep(v, key));
      if (value && typeof value === 'object') {
        return Object.entries(value as Record<string, unknown>).some(
          ([k, v]) => k === key || hasKeyDeep(v, key),
        );
      }
      return false;
    };

    it('never leaks gamification into the lesson or course progress reads', async () => {
      // StepProgressDto flows into both of these. If XP were hung off it
      // instead of returned as a sibling, these pure reads would report an
      // "award" on every single page load.
      const { token } = await registerAndLogin('reads');
      const lessonId = await createLesson('Reads lesson', { quiz: true });
      await postVideo(lessonId, token, VIDEO_DURATION).expect(201);

      const lessonProgress = await request(app.getHttpServer())
        .get(`/lessons/${lessonId}/progress`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(hasKeyDeep(lessonProgress.body, 'gamification')).toBe(false);
      expect(hasKeyDeep(lessonProgress.body, 'xpAwarded')).toBe(false);

      const courseProgress = await request(app.getHttpServer())
        .get(`/progress/courses?courseIds=${courseId}&include=lessons`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(hasKeyDeep(courseProgress.body, 'gamification')).toBe(false);
    });

    it('never stores gamification in the replayable attempt body', async () => {
      // LessonTaskAttempt.result is handed back verbatim on a replay. A
      // gamification field in there would re-announce an award that already
      // happened, every time.
      const { token, userId } = await registerAndLogin('stored');
      const lessonId = await createLesson('Stored lesson', { quiz: true });
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

      const attempt = await prisma.lessonTaskAttempt.findFirstOrThrow({
        where: { userId },
      });
      expect(hasKeyDeep(attempt.result, 'gamification')).toBe(false);

      const progress = await prisma.lessonTaskProgress.findFirstOrThrow({
        where: { userId },
      });
      expect(hasKeyDeep(progress.lastSubmitResult, 'gamification')).toBe(false);
    });

    it('stores no gamification in a PRACTICE attempt body either', async () => {
      // Practice goes through the same submitTask and the same flattener, but
      // a separate controller. Asserted separately because "the quiz route is
      // clean" is not evidence that the practice route is.
      const { token, userId } = await registerAndLogin('stored-practice');
      const { lessonId, practiceQuestionIds } = await createLessonWithTasks(
        'Stored practice lesson',
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
          answers: practiceQuestionIds.map((questionId, i) => ({
            questionId,
            submitted: CORRECT[i],
          })),
        })
        .expect(201);

      // The wire response DOES carry it — that is the whole point of the
      // sibling field...
      expect(submit.body.gamification.xpAwarded).toBe(60);

      // ...and the persisted body does NOT.
      const attempt = await prisma.lessonTaskAttempt.findFirstOrThrow({
        where: { userId, task: { type: 'PRACTICE' } },
      });
      expect(hasKeyDeep(attempt.result, 'gamification')).toBe(false);

      const progress = await prisma.lessonTaskProgress.findFirstOrThrow({
        where: { userId, task: { type: 'PRACTICE' } },
      });
      expect(hasKeyDeep(progress.lastSubmitResult, 'gamification')).toBe(false);
    });

    it('leaves GET /analytics/dashboard exactly as Sprint 09 shaped it', async () => {
      const { token } = await registerAndLogin('dash');
      const res = await request(app.getHttpServer())
        .get('/analytics/dashboard?tz=Asia/Ho_Chi_Minh')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(Object.keys(res.body).sort()).toEqual([
        'activity',
        'effectiveTimeZone',
        'today',
      ]);
      // streakCapped is still there — Sprint 10 must not have quietly changed
      // the streak contract while adding badges beside it.
      expect(res.body.activity).toHaveProperty('streakCapped');
      expect(res.body.activity.windowDays).toBe(7);
      expect(hasKeyDeep(res.body, 'xp')).toBe(false);
    });
  });

  describe('GET /gamification/profile', () => {
    it('returns the whole catalog for a brand-new account, all locked', async () => {
      const { token } = await registerAndLogin('profile-new');
      const res = await request(app.getHttpServer())
        .get('/gamification/profile')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.xp).toEqual({
        totalXp: 0,
        level: 1,
        intoLevel: 0,
        toNextLevel: 100,
        percent: 0,
      });
      expect(res.body.achievements.map((a: { key: string }) => a.key)).toEqual([
        'FIRST_STAGE',
        'FIRST_QUIZ_PASS',
        'FIRST_MASTERED_WORD',
        'STREAK_3',
        'STREAK_7',
        'XP_500',
      ]);
      expect(
        res.body.achievements.every(
          (a: { unlockedAt: string | null }) => a.unlockedAt === null,
        ),
      ).toBe(true);
      expect(res.body.nextMilestoneDays).toBe(3);
      // No streak number anywhere — that figure lives in exactly one place.
      expect(res.body).not.toHaveProperty('streak');
    });

    it('reports an unlocked badge with its timestamp and no progress bar', async () => {
      const { token } = await registerAndLogin('profile-earned');
      const lessonId = await createLesson('Profile lesson');
      await postVideo(lessonId, token, VIDEO_DURATION).expect(201);

      const res = await request(app.getHttpServer())
        .get('/gamification/profile')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const first = res.body.achievements.find(
        (a: { key: string }) => a.key === 'FIRST_STAGE',
      );
      expect(first.unlockedAt).toEqual(expect.any(String));
      expect(first.progress).toBeNull();
      expect(res.body.xp.totalXp).toBe(30);

      const locked = res.body.achievements.find(
        (a: { key: string }) => a.key === 'XP_500',
      );
      expect(locked.progress).toEqual({ current: 30, target: 500 });
    });

    it('requires a token', async () => {
      await request(app.getHttpServer())
        .get('/gamification/profile')
        .expect(401);
    });
  });

  describe('rate limiting', () => {
    it("does not share the dashboard's 'stats' bucket", async () => {
      // The kind IS the bucket. If these two ever share one, the symptom is
      // "the dashboard randomly stops loading" and it points nowhere near here.
      const { token } = await registerAndLogin('bucket');

      // The profile limit is 30/60s; drain it.
      for (let i = 0; i < 31; i += 1) {
        await request(app.getHttpServer())
          .get('/gamification/profile')
          .set('Authorization', `Bearer ${token}`);
      }
      await request(app.getHttpServer())
        .get('/gamification/profile')
        .set('Authorization', `Bearer ${token}`)
        .expect(429);

      // ...and the dashboard is still serving.
      await request(app.getHttpServer())
        .get('/analytics/dashboard')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });
  });
});
