import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { startOfDayInTimeZone } from '../src/learning/timezone.util';
import { MAX_FLUSH_SECONDS } from '../src/study-time/study-time.constants';

// Sprint 10.5 — POST /study-time/heartbeat.
//
// What this suite proves against a real database:
//   - heartbeats reach GET /analytics/dashboard as real minutes;
//   - a replayed (clientSessionId, sequence) credits nothing — idempotency is
//     the DB's job, not the application's;
//   - THE CONVERGENCE CAP ACTUALLY ENGAGES. This is the one that needed care:
//     `elapsedToday` is real time since the machine's local midnight, so a
//     suite running at 15:00 has ~54,000 seconds of headroom and any assertion
//     about the ceiling passes without exercising it. Every cap test below
//     SEEDS rows to push `usedToday` up to the ceiling first, so the behaviour
//     is forced rather than hoped for. The arithmetic itself is covered
//     exhaustively in src/study-time/creditable-seconds.spec.ts.
//   - study time creates NO XpTransaction and NO UserDailyActivity — the
//     assumption a later sprint is most likely to "fix" into a bug;
//   - one student's heartbeats never reach another's dashboard;
//   - the 'study' rate-limit bucket is genuinely its own.
describe('Study time (e2e) — Sprint 10.5', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const createdUserEmails: string[] = [];

  const registerAndLogin = async (
    label: string,
  ): Promise<{ token: string; userId: string }> => {
    const email = `s105-${label.slice(0, 18)}-${randomUUID()}@example.test`;
    createdUserEmails.push(email);
    const register = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: `Sprint 10.5 ${label}`, email, password: 'password123' });
    const userId = (register.body as { user: { id: string } }).user.id;
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'password123', role: 'USER' });
    return {
      token: (login.body as { accessToken: string }).accessToken,
      userId,
    };
  };

  interface HeartbeatOverrides {
    clientSessionId?: string;
    sequence?: number;
    activityType?: string;
    activityId?: string | null;
    activeSeconds?: number;
  }

  const heartbeat = (token: string, overrides: HeartbeatOverrides = {}) => {
    const body: Record<string, unknown> = {
      clientSessionId: overrides.clientSessionId ?? randomUUID(),
      sequence: overrides.sequence ?? 0,
      activityType: overrides.activityType ?? 'THEORY',
      activeSeconds: overrides.activeSeconds ?? 60,
    };
    if (overrides.activityId !== null && overrides.activityId !== undefined) {
      body.activityId = overrides.activityId;
    }
    return request(app.getHttpServer())
      .post('/study-time/heartbeat')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  };

  const studySecondsToday = async (
    token: string,
    tz = 'UTC',
  ): Promise<number> => {
    const res = await request(app.getHttpServer())
      .get('/analytics/dashboard')
      .query({ tz })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return (res.body as { today: { activeStudySeconds: number } }).today
      .activeStudySeconds;
  };

  /**
   * Push this user's credited total up to `elapsedToday - headroom`, so the
   * very next heartbeat meets the ceiling with exactly `headroom` to spare.
   *
   * Written directly through Prisma rather than through the endpoint: going via
   * HTTP would itself be subject to the cap, which is the thing under test.
   * The timezone must match what the assertions use, since the cap and the
   * dashboard both bucket from the same local midnight.
   */
  const seedUsedToday = async (
    userId: string,
    timeZone: string,
    headroom: number,
  ): Promise<void> => {
    const now = new Date();
    const dayStart = startOfDayInTimeZone(now, timeZone);
    const elapsed = Math.floor((now.getTime() - dayStart.getTime()) / 1000);
    const target = elapsed - headroom;
    if (target <= 0) {
      throw new Error(
        `Cannot seed ${target}s: the local day is only ${elapsed}s old.`,
      );
    }
    await prisma.studyTimeEvent.create({
      data: {
        userId,
        activityType: 'THEORY',
        clientSessionId: randomUUID(),
        sequence: 0,
        creditedSeconds: target,
        occurredAt: now,
      },
    });
  };

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
    // StudyTimeEvent needs no explicit sweep entry — userId is Cascade, so
    // deleting the users removes every row. Same reason lessonStepProgress has
    // none in test-fixture-sweep.ts.
    if (createdUserEmails.length) {
      await prisma.user.deleteMany({
        where: { email: { in: createdUserEmails } },
      });
    }
    await app.close();
  });

  describe('authentication and validation', () => {
    it('rejects an unauthenticated heartbeat', async () => {
      await request(app.getHttpServer())
        .post('/study-time/heartbeat')
        .send({
          clientSessionId: randomUUID(),
          sequence: 0,
          activityType: 'THEORY',
          activeSeconds: 60,
        })
        .expect(401);
    });

    it('rejects a heartbeat after logout', async () => {
      const { token } = await registerAndLogin('loggedout');
      await request(app.getHttpServer())
        .post('/auth/logout')
        // Phase 3 — TrustedOriginGuard requires a trusted Origin (.env.test.example's CORS_ALLOWED_ORIGINS).
        .set('Origin', 'http://localhost:5174')
        .set('Authorization', `Bearer ${token}`);

      await heartbeat(token).expect(401);
    });

    // The DTO ceiling. A client flushing once a minute cannot honestly have
    // more than MAX_FLUSH_SECONDS to report.
    it('rejects activeSeconds beyond the flush ceiling with 400', async () => {
      const { token } = await registerAndLogin('toobig');

      await heartbeat(token, { activeSeconds: 999 }).expect(400);
    });

    it('rejects a zero or negative activeSeconds with 400', async () => {
      const { token } = await registerAndLogin('zero');

      await heartbeat(token, { activeSeconds: 0 }).expect(400);
      await heartbeat(token, { activeSeconds: -60 }).expect(400);
    });

    it('rejects a sequence beyond the session ceiling with 400', async () => {
      const { token } = await registerAndLogin('seqmax');

      await heartbeat(token, { sequence: 100_000 }).expect(400);
    });

    it('rejects a non-uuid clientSessionId with 400', async () => {
      const { token } = await registerAndLogin('badsid');

      await heartbeat(token, { clientSessionId: 'not-a-uuid' }).expect(400);
    });

    it('rejects an unknown activityType with 400', async () => {
      const { token } = await registerAndLogin('badtype');

      await heartbeat(token, { activityType: 'NAPPING' }).expect(400);
    });

    it('accepts every declared activity type', async () => {
      const { token } = await registerAndLogin('alltypes');
      const types = [
        'VIDEO',
        'THEORY',
        'QUIZ',
        'PRACTICE',
        'TRAP_HUNTER',
        'SRS_REVIEW',
        'VOCAB_PRACTICE',
        'LISTENING',
      ];

      for (const [index, activityType] of types.entries()) {
        await heartbeat(token, { activityType, sequence: index }).expect(201);
      }
    });
  });

  describe('crediting', () => {
    it('credits a heartbeat and surfaces it on the dashboard', async () => {
      const { token } = await registerAndLogin('credit');

      const res = await heartbeat(token, { activeSeconds: 60 }).expect(201);

      expect((res.body as { acceptedSeconds: number }).acceptedSeconds).toBe(
        60,
      );
      expect(await studySecondsToday(token)).toBe(60);
    });

    it('sums three heartbeats of one session into 180 seconds', async () => {
      const { token } = await registerAndLogin('threebeats');
      const clientSessionId = randomUUID();

      for (const sequence of [0, 1, 2]) {
        await heartbeat(token, {
          clientSessionId,
          sequence,
          activeSeconds: 60,
        }).expect(201);
      }

      expect(await studySecondsToday(token)).toBe(180);
    });

    it('accepts an untrusted activityId without validating it', async () => {
      // Documented, deliberate: activityId is an analytics dimension with the
      // same standing as WordReviewLog.sessionId. It gates nothing, and the
      // credited amount does not depend on it, so a lesson that does not exist
      // is stored rather than rejected. If this ever starts 404ing, the
      // trade-off in schema.prisma was changed without updating this test.
      const { token } = await registerAndLogin('ghostid');

      const res = await heartbeat(token, {
        activityId: randomUUID(),
      }).expect(201);

      expect((res.body as { acceptedSeconds: number }).acceptedSeconds).toBe(
        60,
      );
    });

    // Listening lessons are client-seeded content with SLUG ids, not UUIDs
    // (listeningContent.ts). A UUID-shaped validator here would have made every
    // Listening heartbeat a 400 and left that module contributing zero minutes,
    // silently — which is the exact gap Sprint 09 left open and this sprint set
    // out to close.
    it('accepts a slug activityId, as Listening lessons use', async () => {
      const { token } = await registerAndLogin('slugid');

      const res = await heartbeat(token, {
        activityType: 'LISTENING',
        activityId: 'office-relocation-notice',
      }).expect(201);

      expect((res.body as { acceptedSeconds: number }).acceptedSeconds).toBe(
        60,
      );
    });

    it('rejects an over-long activityId with 400', async () => {
      const { token } = await registerAndLogin('longid');

      await heartbeat(token, { activityId: 'x'.repeat(65) }).expect(400);
    });
  });

  describe('idempotency', () => {
    it('credits nothing for a replayed (session, sequence)', async () => {
      const { token } = await registerAndLogin('replay');
      const clientSessionId = randomUUID();

      const first = await heartbeat(token, {
        clientSessionId,
        sequence: 7,
        activeSeconds: 60,
      }).expect(201);
      const replay = await heartbeat(token, {
        clientSessionId,
        sequence: 7,
        activeSeconds: 60,
      }).expect(201);

      expect((first.body as { acceptedSeconds: number }).acceptedSeconds).toBe(
        60,
      );
      expect((replay.body as { acceptedSeconds: number }).acceptedSeconds).toBe(
        0,
      );
      expect(await studySecondsToday(token)).toBe(60);
    });

    it('keeps two tabs of the same user independent by session id', async () => {
      const { token } = await registerAndLogin('twosessions');

      await heartbeat(token, {
        clientSessionId: randomUUID(),
        sequence: 0,
      }).expect(201);
      await heartbeat(token, {
        clientSessionId: randomUUID(),
        sequence: 0,
      }).expect(201);

      // Same sequence, different session — both land. Cross-tab suppression is
      // the client's leader lock (10.5C); the server's job is only that the
      // idempotency key does not collide between sessions.
      expect(await studySecondsToday(token)).toBe(120);
    });
  });

  // THE CAP TESTS. Every one seeds usedToday first so the ceiling is genuinely
  // reached — see the note at the top of this file.
  describe('the convergence cap', () => {
    const TZ = 'UTC';

    it('credits ZERO once the day is already spent', async () => {
      const { token, userId } = await registerAndLogin('spent');
      await seedUsedToday(userId, TZ, 0);

      const res = await heartbeat(token, { activeSeconds: 60 }).expect(201);

      expect((res.body as { acceptedSeconds: number }).acceptedSeconds).toBe(0);
    });

    it('clamps a heartbeat to the remaining headroom', async () => {
      const { token, userId } = await registerAndLogin('clamp');
      await seedUsedToday(userId, TZ, 30);

      const res = await heartbeat(token, { activeSeconds: 60 }).expect(201);

      // 30 seconds of headroom, 60 requested. The extra 30 is refused.
      expect((res.body as { acceptedSeconds: number }).acceptedSeconds).toBe(
        30,
      );
    });

    it('writes NO row when the cap refuses everything', async () => {
      const { token, userId } = await registerAndLogin('norow');
      await seedUsedToday(userId, TZ, 0);
      const before = await prisma.studyTimeEvent.count({ where: { userId } });

      await heartbeat(token, { activeSeconds: 60 }).expect(201);

      // A spent day must not accumulate a stream of zero-second rows.
      expect(await prisma.studyTimeEvent.count({ where: { userId } })).toBe(
        before,
      );
    });

    it('stays within the bound under CONCURRENT clients, then converges', async () => {
      const { token, userId } = await registerAndLogin('concurrent');
      const CLIENTS = 3;
      await seedUsedToday(userId, TZ, 30);

      // Three "devices" firing together. At READ COMMITTED with no row lock
      // they can each observe the same usedToday, so over-credit is possible —
      // the guarantee is that it is BOUNDED, not that it is impossible.
      await Promise.all(
        Array.from({ length: CLIENTS }, () =>
          heartbeat(token, {
            clientSessionId: randomUUID(),
            sequence: 0,
            activeSeconds: 60,
          }).expect(201),
        ),
      );

      const now = new Date();
      const dayStart = startOfDayInTimeZone(now, TZ);
      const elapsed = Math.floor((now.getTime() - dayStart.getTime()) / 1000);
      const total = await studySecondsToday(token, TZ);

      // BOUNDED — deliberately not `total <= elapsed`, which is the assertion
      // that would be wrong for the right reason.
      expect(total).toBeLessThanOrEqual(elapsed + MAX_FLUSH_SECONDS * CLIENTS);

      // CONVERGENT — whatever happened above, the day is now at or past its
      // ceiling, so the next heartbeat credits nothing. Over-credit does not
      // accumulate across rounds.
      const after = await heartbeat(token, {
        clientSessionId: randomUUID(),
        sequence: 0,
        activeSeconds: 60,
      }).expect(201);
      expect((after.body as { acceptedSeconds: number }).acceptedSeconds).toBe(
        0,
      );
    });
  });

  describe('isolation from other subsystems', () => {
    it('awards NO xp and creates NO activity day', async () => {
      // Study time is a measurement, not an achievement. If this ever starts
      // failing, someone has wired minutes into the XP ledger — which would
      // also make the daily target an XP multiplier the student controls, the
      // exact thing Sprint 09 warned against.
      const { token, userId } = await registerAndLogin('noxp');

      await heartbeat(token, { activeSeconds: 60 }).expect(201);

      expect(await prisma.xpTransaction.count({ where: { userId } })).toBe(0);
      expect(await prisma.userDailyActivity.count({ where: { userId } })).toBe(
        0,
      );
    });

    it('never leaks one student’s study time into another’s dashboard', async () => {
      const alice = await registerAndLogin('alice');
      const bob = await registerAndLogin('bob');

      await heartbeat(alice.token, { activeSeconds: 60 }).expect(201);

      expect(await studySecondsToday(alice.token)).toBe(60);
      expect(await studySecondsToday(bob.token)).toBe(0);
    });
  });

  describe('rate limiting', () => {
    // Proves the bucket did not silently end up shared. 'step' is the dangerous
    // neighbour: the video player posts under it on the same pages.
    it('exhausting the study bucket leaves video progress serving', async () => {
      const { token } = await registerAndLogin('bucket');
      const clientSessionId = randomUUID();

      let throttled = false;
      for (let sequence = 0; sequence < 40; sequence += 1) {
        const res = await heartbeat(token, {
          clientSessionId,
          sequence,
          activeSeconds: 1,
        });
        if (res.status === 429) {
          throttled = true;
          break;
        }
      }
      expect(throttled).toBe(true);

      // A 404 here is the lesson not existing, which is fine — what matters is
      // that it is not a 429 from a shared counter.
      const stepRes = await request(app.getHttpServer())
        .post(`/lessons/${randomUUID()}/steps/theory/start`)
        .set('Authorization', `Bearer ${token}`);
      expect(stepRes.status).not.toBe(429);
    });
  });
});
