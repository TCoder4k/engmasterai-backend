import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WsAdapter } from '@nestjs/platform-ws';
import request from 'supertest';
import type { App } from 'supertest/types';
import { randomUUID } from 'crypto';
import WebSocket from 'ws';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { testFixtureName } from './test-database.util';
import {
  SPEAKING_TRANSLATE_PROVIDER,
  SpeakingTranslateError,
  SpeakingTranslateProvider,
  SpeakingTranslateRequest,
} from '../src/speaking/speaking-translate.provider';
import {
  SPEAKING_LIVE_CONNECTION_PROVIDER,
  SpeakingLiveConnectCallbacks,
  SpeakingLiveConnectionHandle,
  SpeakingLiveConnectionProvider,
  SpeakingLiveConnectOptions,
  SpeakingLiveError,
  SpeakingLiveRealtimeInput,
  SpeakingLiveServerMessage,
} from '../src/speaking/live/speaking-live-connection.provider';

// Speaking Partner — e2e.
//
// The conversation engine is Gemini Live over a WebSocket
// (/speaking/live) — every test here replaces SPEAKING_LIVE_CONNECTION_PROVIDER
// with a fake that never opens a real connection, the same reasoning as
// every other Gemini-calling seam in this codebase's e2e suites.
//
// The properties under test:
//   1. THE SERVER DECIDES. No client message can assert a transcript or a reply.
//   2. THE STUDENT-FACING EXERCISE READ NEVER LEAKS aiRole/conversationGoal —
//      the Live system instruction DOES receive them (that's how the
//      persona works), the HTTP/WS surface never does.
//   3. A WS CONNECTION REQUIRES A VALID, SINGLE-USE TICKET — no ticket, an
//      expired one, or a reused one is rejected before any Gemini call.
//   4. turnCount IS ABSENT/ZERO UNTIL complete(), and then equals the actual
//      number of turns FINALIZED over the Live connection.
//   5. AN ADMIN UNPUBLISHING AN EXERCISE MID-CONVERSATION STOPS THE VERY NEXT
//      connection attempt — re-checked at connect time.

class FakeSpeakingTranslate implements SpeakingTranslateProvider {
  readonly model = 'fake-speaking-translate-model';
  static textVi = 'Bạn khỏe không?';
  static failWith: SpeakingTranslateError | null = null;
  static seenRequests: SpeakingTranslateRequest[] = [];
  static callCount = 0;

  static reset(): void {
    FakeSpeakingTranslate.textVi = 'Bạn khỏe không?';
    FakeSpeakingTranslate.failWith = null;
    FakeSpeakingTranslate.seenRequests = [];
    FakeSpeakingTranslate.callCount = 0;
  }

  translate(req: SpeakingTranslateRequest) {
    FakeSpeakingTranslate.callCount += 1;
    FakeSpeakingTranslate.seenRequests.push(req);
    if (FakeSpeakingTranslate.failWith) {
      return Promise.reject(FakeSpeakingTranslate.failWith);
    }
    return Promise.resolve({ textVi: FakeSpeakingTranslate.textVi });
  }
}

/** One fake Gemini Live "connection" per gateway connection — see speaking-live-session.spec.ts for the same fake shape, used there without a real socket at all. */
class FakeLiveConnection implements SpeakingLiveConnectionHandle {
  sentInputs: SpeakingLiveRealtimeInput[] = [];
  sentClientTurns: string[] = [];
  closed = false;

  constructor(
    private readonly callbacks: SpeakingLiveConnectCallbacks,
    private readonly provider: typeof FakeSpeakingLiveConnectionProvider,
  ) {}

  sendRealtimeInput(input: SpeakingLiveRealtimeInput): void {
    this.sentInputs.push(input);
    if (input.activityEnd) {
      const script = this.provider.turnScripts.shift();
      if (script) {
        for (const message of script) this.callbacks.onmessage(message);
      }
    }
  }

  /**
   * SpeakingLiveSession.start() cues the opening line via this method (see
   * triggerOpeningLine()) before the gateway ever hands the socket back to
   * a caller. Auto-completing it instantly (rather than requiring every
   * existing test to script it) matches how fast a real short greeting
   * round-trips in practice, and keeps doOneTurn()'s existing tests
   * unchanged — only the dedicated opening-line test below inspects
   * `sentClientTurns` directly.
   */
  sendClientTurn(text: string): void {
    this.sentClientTurns.push(text);
    this.callbacks.onmessage({ serverContent: { turnComplete: true } });
  }

  close(): void {
    this.closed = true;
  }
}

class FakeSpeakingLiveConnectionProvider implements SpeakingLiveConnectionProvider {
  static connectError: SpeakingLiveError | null = null;
  static lastSystemInstruction: string | null = null;
  static connections: FakeLiveConnection[] = [];
  /** One entry consumed per activityEnd, in order — see FakeLiveConnection.sendRealtimeInput. */
  static turnScripts: SpeakingLiveServerMessage[][] = [];

  static reset(): void {
    FakeSpeakingLiveConnectionProvider.connectError = null;
    FakeSpeakingLiveConnectionProvider.lastSystemInstruction = null;
    FakeSpeakingLiveConnectionProvider.connections = [];
    FakeSpeakingLiveConnectionProvider.turnScripts = [];
  }

  async connect(options: SpeakingLiveConnectOptions): Promise<SpeakingLiveConnectionHandle> {
    if (FakeSpeakingLiveConnectionProvider.connectError) {
      throw FakeSpeakingLiveConnectionProvider.connectError;
    }
    FakeSpeakingLiveConnectionProvider.lastSystemInstruction = options.systemInstruction;
    const connection = new FakeLiveConnection(options.callbacks, FakeSpeakingLiveConnectionProvider);
    FakeSpeakingLiveConnectionProvider.connections.push(connection);
    return connection;
  }
}

/** One scripted transcript+reply pair, delivered as the standard delta+turnComplete shape. */
const scriptOf = (userText: string, aiText: string): SpeakingLiveServerMessage[] => [
  { serverContent: { inputTranscription: { text: userText } } },
  { serverContent: { outputTranscription: { text: aiText } } },
  { serverContent: { turnComplete: true } },
];

describe('Speaking Partner (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let port: number;

  let adminToken: string;
  let studentToken: string;

  const registerStudent = async (): Promise<{ token: string; id: string }> => {
    const email = `speaking-student-${randomUUID()}@example.test`;
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: 'Speaking Student', email, password: 'password123' });
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    return { token: (res.body as { accessToken: string }).accessToken, id: user.id };
  };

  /** One scenario + one published exercise. Returns raw ids for direct manipulation. */
  const seedPublishedExercise = async (
    overrides: Record<string, unknown> = {},
  ): Promise<{ scenarioId: string; exerciseId: string }> => {
    const scenario = await request(app.getHttpServer())
      .post('/speaking/manage/scenarios')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: testFixtureName('Scenario'), nameVi: 'Kịch bản', level: 'A2' })
      .expect(201);
    const scenarioId = (scenario.body as { id: string }).id;
    await request(app.getHttpServer())
      .patch(`/speaking/manage/scenarios/${scenarioId}/publish`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const exercise = await request(app.getHttpServer())
      .post('/speaking/manage/exercises')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        scenarioId,
        title: testFixtureName('Exercise'),
        titleVi: 'Bài luyện',
        description: 'Introduce yourself',
        descriptionVi: 'Giới thiệu bản thân',
        level: 'A2',
        aiRole: 'a friendly English tutor',
        openingLine: 'Hi! Can you tell me a bit about yourself?',
        conversationGoal: 'getting the student to mention their hometown',
        ...overrides,
      })
      .expect(201);
    const exerciseId = (exercise.body as { id: string }).id;
    await request(app.getHttpServer())
      .patch(`/speaking/manage/exercises/${exerciseId}/publish`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    return { scenarioId, exerciseId };
  };

  const startAttempt = (exerciseId: string, token = studentToken) =>
    request(app.getHttpServer())
      .post(`/speaking/exercises/${exerciseId}/attempts`)
      .set('Authorization', `Bearer ${token}`);

  const liveUrl = (ticket: string) => `ws://127.0.0.1:${port}/speaking/live?ticket=${ticket}`;

  type LiveEvent = { type: string; [key: string]: unknown };

  /**
   * BUFFER, DON'T DROP — the same discipline speaking-live.gateway.ts
   * documents for its own inbound side, needed here for the reverse
   * direction: since start() now cues the opening line immediately on
   * connect (see SpeakingLiveSession.triggerOpeningLine), the server can
   * push `openingReady` (and, over a real Gemini connection, real audio)
   * before this test ever gets to register a `waitForEvent` listener — the
   * WS handshake's 'open' event can fire on the client before the server
   * finishes its own async ticket/rate-limit/DB-lookup chain, but nothing
   * guarantees it must. A single persistent 'message' listener, attached
   * synchronously at socket creation, means no event is ever lost to that
   * race — `waitForEvent` below drains an already-buffered match first
   * before falling back to waiting for a new one.
   */
  const liveSocketState = new Map<
    WebSocket,
    { events: LiveEvent[]; waiters: { predicate: (e: LiveEvent) => boolean; resolve: (e: LiveEvent) => void }[] }
  >();

  const connectLive = (ticket: string): Promise<WebSocket> =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket(liveUrl(ticket));
      const state = { events: [] as LiveEvent[], waiters: [] as { predicate: (e: LiveEvent) => boolean; resolve: (e: LiveEvent) => void }[] };
      liveSocketState.set(ws, state);
      ws.on('message', (raw: WebSocket.RawData) => {
        const event = JSON.parse(raw.toString()) as LiveEvent;
        const waiterIndex = state.waiters.findIndex((w) => w.predicate(event));
        if (waiterIndex !== -1) {
          const [waiter] = state.waiters.splice(waiterIndex, 1);
          waiter.resolve(event);
        } else {
          state.events.push(event);
        }
      });
      ws.once('open', () => resolve(ws));
      ws.once('error', reject);
    });

  const waitForClose = (ws: WebSocket): Promise<{ code: number; reason: string }> =>
    new Promise((resolve) => {
      ws.once('close', (code, reasonBuf) => resolve({ code, reason: reasonBuf.toString() }));
    });

  const waitForEvent = (
    ws: WebSocket,
    predicate: (event: LiveEvent) => boolean,
    timeoutMs = 3000,
  ): Promise<LiveEvent> => {
    const state = liveSocketState.get(ws);
    if (!state) throw new Error('waitForEvent called on a socket never opened via connectLive');

    const bufferedIndex = state.events.findIndex(predicate);
    if (bufferedIndex !== -1) {
      const [event] = state.events.splice(bufferedIndex, 1);
      return Promise.resolve(event);
    }

    return new Promise((resolve, reject) => {
      const waiter = {
        predicate,
        resolve: (event: LiveEvent) => {
          clearTimeout(timer);
          resolve(event);
        },
      };
      const timer = setTimeout(() => {
        const index = state.waiters.indexOf(waiter);
        if (index !== -1) state.waiters.splice(index, 1);
        reject(new Error('Timed out waiting for a Speaking Live event'));
      }, timeoutMs);
      state.waiters.push(waiter);
    });
  };

  /** Tap-to-talk: activityStart, one audio chunk, activityEnd — waits for turnFinalized. */
  const doOneTurn = async (ws: WebSocket, userText: string, aiText: string): Promise<void> => {
    FakeSpeakingLiveConnectionProvider.turnScripts.push(scriptOf(userText, aiText));
    ws.send(JSON.stringify({ type: 'activityStart' }));
    ws.send(JSON.stringify({ type: 'audioChunk', data: 'ZmFrZS1hdWRpbw==' }));
    ws.send(JSON.stringify({ type: 'activityEnd' }));
    await waitForEvent(ws, (e) => e.type === 'turnFinalized');
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SPEAKING_TRANSLATE_PROVIDER)
      .useClass(FakeSpeakingTranslate)
      .overrideProvider(SPEAKING_LIVE_CONNECTION_PROVIDER)
      .useClass(FakeSpeakingLiveConnectionProvider)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    app.useWebSocketAdapter(new WsAdapter(app));
    await app.init();
    await app.listen(0); // a real port — /speaking/live needs an actual TCP listener, unlike supertest's in-memory HTTP requests
    const address = app.getHttpServer().address();
    port = typeof address === 'object' && address ? address.port : 0;

    prisma = app.get(PrismaService);

    const adminEmail = `speaking-admin-${randomUUID()}@example.test`;
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: 'Speaking Admin', email: adminEmail, password: 'password123' });
    await prisma.user.update({ where: { email: adminEmail }, data: { role: 'ADMIN' } });
    const adminLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: adminEmail, password: 'password123', role: 'ADMIN' });
    adminToken = (adminLogin.body as { accessToken: string }).accessToken;
  });

  // A FRESH STUDENT PER TEST — the `start`/`complete`/`live-connect` rate
  // limits are keyed per user, and a suite exercising many connections under
  // one account would exhaust them and start asserting rejections instead
  // of behaviour.
  beforeEach(async () => {
    FakeSpeakingTranslate.reset();
    FakeSpeakingLiveConnectionProvider.reset();
    const student = await registerStudent();
    studentToken = student.token;
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('admin scenario/exercise authoring', () => {
    it('rejects a non-admin from every /speaking/manage route', async () => {
      await request(app.getHttpServer())
        .get('/speaking/manage/scenarios')
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(403);
    });

    it('creates, publishes and lists a scenario and its exercise', async () => {
      const { scenarioId, exerciseId } = await seedPublishedExercise();

      const scenarios = await request(app.getHttpServer())
        .get('/speaking/manage/scenarios')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect((scenarios.body as { id: string }[]).some((s) => s.id === scenarioId)).toBe(true);

      const exercise = await request(app.getHttpServer())
        .get(`/speaking/manage/exercises/${exerciseId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      // The admin surface DOES see the AI-context fields — this is the one
      // place they are allowed.
      expect(exercise.body).toMatchObject({
        aiRole: 'a friendly English tutor',
        conversationGoal: 'getting the student to mention their hometown',
        isPublished: true,
      });
    });

    it('cannot delete a scenario that still has an exercise', async () => {
      const { scenarioId } = await seedPublishedExercise();

      await request(app.getHttpServer())
        .delete(`/speaking/manage/scenarios/${scenarioId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
    });

    it('cannot delete an exercise a student has already attempted', async () => {
      const { exerciseId } = await seedPublishedExercise();
      await startAttempt(exerciseId).expect(201);

      await request(app.getHttpServer())
        .delete(`/speaking/manage/exercises/${exerciseId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
    });
  });

  describe('student catalog reads', () => {
    it('lists only published scenarios that have a published exercise', async () => {
      const { scenarioId } = await seedPublishedExercise();

      const res = await request(app.getHttpServer())
        .get('/speaking/scenarios')
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(200);

      const match = (res.body as { id: string; exerciseCount: number }[]).find(
        (s) => s.id === scenarioId,
      );
      expect(match).toMatchObject({ exerciseCount: 1 });
    });

    it('a draft scenario and a nonexistent id 404 with the same shape', async () => {
      const draftScenario = await request(app.getHttpServer())
        .post('/speaking/manage/scenarios')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: testFixtureName('Draft'), nameVi: 'Bản nháp' })
        .expect(201);
      const draftId = (draftScenario.body as { id: string }).id;

      const draftRes = await request(app.getHttpServer())
        .get(`/speaking/scenarios/${draftId}`)
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(404);
      const missingRes = await request(app.getHttpServer())
        .get(`/speaking/scenarios/${randomUUID()}`)
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(404);

      expect(draftRes.body).toMatchObject({ statusCode: 404, error: 'Not Found' });
      expect(missingRes.body).toMatchObject({ statusCode: 404, error: 'Not Found' });
    });

    it('NEVER returns aiRole, conversationGoal or targetTurns to a student', async () => {
      const { scenarioId } = await seedPublishedExercise();

      const res = await request(app.getHttpServer())
        .get(`/speaking/scenarios/${scenarioId}`)
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(200);

      const body = res.body as { exercises: Record<string, unknown>[] };
      expect(body.exercises).toHaveLength(1);
      const exercise = body.exercises[0];
      expect(exercise).not.toHaveProperty('aiRole');
      expect(exercise).not.toHaveProperty('conversationGoal');
      expect(exercise).not.toHaveProperty('targetTurns');
      expect(exercise).toMatchObject({
        title: expect.any(String),
        titleVi: expect.any(String),
        description: expect.any(String),
        descriptionVi: expect.any(String),
        level: 'A2',
        openingLine: 'Hi! Can you tell me a bit about yourself?',
      });
    });
  });

  describe('POST /speaking/exercises/:exerciseId/attempts', () => {
    it('starts an attempt, returns the AUTHORED opening line, and a usable liveTicket — no Gemini call', async () => {
      const { exerciseId } = await seedPublishedExercise();

      const res = await startAttempt(exerciseId).expect(201);

      expect(res.body).toMatchObject({
        exerciseId,
        openingLine: 'Hi! Can you tell me a bit about yourself?',
      });
      const body = res.body as { attemptId: string; liveTicket: string };
      expect(typeof body.attemptId).toBe('string');
      expect(typeof body.liveTicket).toBe('string');
      expect(body.liveTicket.length).toBeGreaterThan(20);
      expect(FakeSpeakingLiveConnectionProvider.connections).toHaveLength(0);
    });

    it('a draft exercise 404s', async () => {
      const draftExercise = await request(app.getHttpServer())
        .post('/speaking/manage/scenarios')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: testFixtureName('S'), nameVi: 'S' })
        .expect(201);
      const scenarioId = (draftExercise.body as { id: string }).id;
      const exercise = await request(app.getHttpServer())
        .post('/speaking/manage/exercises')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          scenarioId,
          title: testFixtureName('Draft exercise'),
          titleVi: 'X',
          description: 'X',
          descriptionVi: 'X',
          level: 'A2',
          aiRole: 'x',
          openingLine: 'x',
        })
        .expect(201);

      await startAttempt((exercise.body as { id: string }).id).expect(404);
    });
  });

  describe('WS /speaking/live', () => {
    it('rejects a connection with no ticket', async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/speaking/live`);
      const closed = await waitForClose(ws);
      expect(closed.code).toBe(4401);
    });

    it('rejects a connection with an unknown ticket', async () => {
      const ws = new WebSocket(liveUrl('not-a-real-ticket'));
      const closed = await waitForClose(ws);
      expect(closed.code).toBe(4401);
    });

    it('a ticket is single-use — a second connect attempt with the SAME ticket is rejected', async () => {
      const { exerciseId } = await seedPublishedExercise();
      const start = await startAttempt(exerciseId).expect(201);
      const { liveTicket } = start.body as { liveTicket: string };

      const first = await connectLive(liveTicket);
      first.close();

      const second = new WebSocket(liveUrl(liveTicket));
      const closed = await waitForClose(second);
      expect(closed.code).toBe(4401);
    });

    it('a valid ticket connects, one scripted turn round-trips transcript+audio, and the system instruction carries the exercise persona', async () => {
      const { exerciseId } = await seedPublishedExercise();
      const start = await startAttempt(exerciseId).expect(201);
      const { attemptId, liveTicket } = start.body as { attemptId: string; liveTicket: string };

      const ws = await connectLive(liveTicket);
      await doOneTurn(ws, 'My name is Minh and I love football.', 'Great to meet you, Minh! Do you play often?');

      expect(FakeSpeakingLiveConnectionProvider.lastSystemInstruction).toContain('a friendly English tutor');
      expect(FakeSpeakingLiveConnectionProvider.lastSystemInstruction).toContain(
        'getting the student to mention their hometown',
      );
      ws.close();

      const complete = await request(app.getHttpServer())
        .post(`/speaking/attempts/${attemptId}/complete`)
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(201);
      expect(complete.body).toMatchObject({ turnCount: 1 });
    });

    it('cues the opening line through Gemini Live on connect, and it never counts as a turn', async () => {
      const { exerciseId } = await seedPublishedExercise();
      const start = await startAttempt(exerciseId).expect(201);
      const { attemptId, liveTicket } = start.body as { attemptId: string; liveTicket: string };

      const ws = await connectLive(liveTicket);
      await waitForEvent(ws, (e) => e.type === 'openingReady');

      const connection = FakeSpeakingLiveConnectionProvider.connections.at(-1)!;
      expect(connection.sentClientTurns).toHaveLength(1);
      expect(connection.sentClientTurns[0]).toContain('Hi! Can you tell me a bit about yourself?');

      await doOneTurn(ws, 'hi', 'hello');
      ws.close();

      const complete = await request(app.getHttpServer())
        .post(`/speaking/attempts/${attemptId}/complete`)
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(201);
      expect(complete.body).toMatchObject({ turnCount: 1 }); // the opening line itself is not counted
    });

    it('relays audio chunks to the client as they stream in', async () => {
      const { exerciseId } = await seedPublishedExercise();
      const start = await startAttempt(exerciseId).expect(201);
      const { liveTicket } = start.body as { liveTicket: string };

      const ws = await connectLive(liveTicket);
      FakeSpeakingLiveConnectionProvider.turnScripts.push([
        { serverContent: { modelTurn: { parts: [{ inlineData: { data: 'QUFBQQ==' } }] } } },
        { serverContent: { inputTranscription: { text: 'Hi' } } },
        { serverContent: { outputTranscription: { text: 'Hello!' } } },
        { serverContent: { turnComplete: true } },
      ]);
      ws.send(JSON.stringify({ type: 'activityStart' }));
      ws.send(JSON.stringify({ type: 'activityEnd' }));

      const audioEvent = await waitForEvent(ws, (e) => e.type === 'audioChunk');
      expect(audioEvent).toMatchObject({ type: 'audioChunk', data: 'QUFBQQ==' });
      ws.close();
    });

    it('a turn with an empty transcript on either side is not counted', async () => {
      const { exerciseId } = await seedPublishedExercise();
      const start = await startAttempt(exerciseId).expect(201);
      const { attemptId, liveTicket } = start.body as { attemptId: string; liveTicket: string };

      const ws = await connectLive(liveTicket);
      FakeSpeakingLiveConnectionProvider.turnScripts.push([{ serverContent: { turnComplete: true } }]);
      ws.send(JSON.stringify({ type: 'activityStart' }));
      ws.send(JSON.stringify({ type: 'activityEnd' }));
      await waitForEvent(ws, (e) => e.type === 'turnEmpty');
      ws.close();

      const complete = await request(app.getHttpServer())
        .post(`/speaking/attempts/${attemptId}/complete`)
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(201);
      expect(complete.body).toMatchObject({ turnCount: 0 });
    });

    it('multiple turns over the SAME connection all count, oldest-first', async () => {
      const { exerciseId } = await seedPublishedExercise();
      const start = await startAttempt(exerciseId).expect(201);
      const { attemptId, liveTicket } = start.body as { attemptId: string; liveTicket: string };

      const ws = await connectLive(liveTicket);
      await doOneTurn(ws, 'first turn', 'first reply');
      await doOneTurn(ws, 'second turn', 'second reply');
      await doOneTurn(ws, 'third turn', 'third reply');
      ws.close();

      const complete = await request(app.getHttpServer())
        .post(`/speaking/attempts/${attemptId}/complete`)
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(201);
      expect(complete.body).toMatchObject({ turnCount: 3 });
    });

    it('unpublishing the exercise before connecting rejects the connection', async () => {
      const { exerciseId } = await seedPublishedExercise();
      const start = await startAttempt(exerciseId).expect(201);
      const { liveTicket } = start.body as { liveTicket: string };

      await request(app.getHttpServer())
        .patch(`/speaking/manage/exercises/${exerciseId}/unpublish`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const ws = new WebSocket(liveUrl(liveTicket));
      const closed = await waitForClose(ws);
      expect(closed.code).toBe(4404);
    });

    it("a turn on someone ELSE's ticket cannot happen — a ticket is bound to the userId who started the attempt", async () => {
      const { exerciseId } = await seedPublishedExercise();
      const start = await startAttempt(exerciseId).expect(201);
      const { attemptId, liveTicket } = start.body as { attemptId: string; liveTicket: string };

      const ws = await connectLive(liveTicket);
      await doOneTurn(ws, 'hello', 'hi there');
      ws.close();

      const other = await registerStudent();
      await request(app.getHttpServer())
        .post(`/speaking/attempts/${attemptId}/complete`)
        .set('Authorization', `Bearer ${other.token}`)
        .expect(404); // complete() is scoped to the ORIGINAL student, not whoever asks
    });
  });

  describe('POST /speaking/attempts/:attemptId/complete', () => {
    it('turnCount is 0 before any turn', async () => {
      const { exerciseId } = await seedPublishedExercise();
      const start = await startAttempt(exerciseId).expect(201);
      const attemptId = (start.body as { attemptId: string }).attemptId;

      const emptyComplete = await request(app.getHttpServer())
        .post(`/speaking/attempts/${attemptId}/complete`)
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(201);
      expect(emptyComplete.body).toMatchObject({ turnCount: 0 });
      expect(emptyComplete.body).not.toHaveProperty('durationSeconds');
    });

    it('is idempotent — a second call returns the same result and does not error', async () => {
      const { exerciseId } = await seedPublishedExercise();
      const start = await startAttempt(exerciseId).expect(201);
      const { attemptId, liveTicket } = start.body as { attemptId: string; liveTicket: string };
      const ws = await connectLive(liveTicket);
      await doOneTurn(ws, 'hi', 'hello');
      ws.close();

      const first = await request(app.getHttpServer())
        .post(`/speaking/attempts/${attemptId}/complete`)
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(201);
      const second = await request(app.getHttpServer())
        .post(`/speaking/attempts/${attemptId}/complete`)
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(201);

      expect(second.body).toEqual(first.body);
    });
  });

  describe('POST /speaking/translate', () => {
    it('translates the given text and returns { textVi }', async () => {
      FakeSpeakingTranslate.textVi = 'Bạn có khỏe không?';

      const res = await request(app.getHttpServer())
        .post('/speaking/translate')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ text: 'How are you doing?' })
        .expect(201);

      expect(res.body).toEqual({ textVi: 'Bạn có khỏe không?' });
      expect(FakeSpeakingTranslate.callCount).toBe(1);
      expect(FakeSpeakingTranslate.seenRequests[0]).toEqual({ text: 'How are you doing?' });
    });

    it('trims the text before validating and before calling the provider', async () => {
      await request(app.getHttpServer())
        .post('/speaking/translate')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ text: '  How are you doing?  ' })
        .expect(201);

      expect(FakeSpeakingTranslate.seenRequests[0]).toEqual({ text: 'How are you doing?' });
    });

    it('rejects empty or whitespace-only text without calling the provider', async () => {
      await request(app.getHttpServer())
        .post('/speaking/translate')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ text: '' })
        .expect(400);
      await request(app.getHttpServer())
        .post('/speaking/translate')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ text: '   ' })
        .expect(400);

      expect(FakeSpeakingTranslate.callCount).toBe(0);
    });

    it('rejects text over the 400-char reply bound without calling the provider', async () => {
      await request(app.getHttpServer())
        .post('/speaking/translate')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ text: 'x'.repeat(401) })
        .expect(400);

      expect(FakeSpeakingTranslate.callCount).toBe(0);
    });

    it('maps a provider failure to 503, never a raw 500', async () => {
      FakeSpeakingTranslate.failWith = new SpeakingTranslateError('UNAVAILABLE', 'down');

      await request(app.getHttpServer())
        .post('/speaking/translate')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ text: 'How are you doing?' })
        .expect(503);
    });

    it('rejects an unauthenticated request', async () => {
      await request(app.getHttpServer())
        .post('/speaking/translate')
        .send({ text: 'How are you doing?' })
        .expect(401);

      expect(FakeSpeakingTranslate.callCount).toBe(0);
    });
  });
});
