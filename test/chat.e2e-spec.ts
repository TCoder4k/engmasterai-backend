import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  ENGY_CHAT_PROVIDER,
  EngyChatError,
  EngyChatProvider,
  EngyChatRequest,
} from '../src/chat/engy-chat.provider';

/**
 * Phase B — a chat engine under the test's control, the same seam
 * FakeRoadmapAnalysis/FakePronunciationFeedback exercise in their own
 * e2e suites. Without this token, chatting could only be exercised with
 * paid, non-deterministic real Gemini calls from CI.
 *
 * `seenRequests` proves the seam actually receives the bounded history +
 * new message the service built, not just that SOME string comes back;
 * `callCount` is what the idempotent-replay tests assert against.
 */
class FakeEngyChat implements EngyChatProvider {
  readonly model = 'fake-engy-model';
  static reply = 'This is a fake Engy reply.';
  static failWith: EngyChatError | null = null;
  static seenRequests: EngyChatRequest[] = [];
  static callCount = 0;

  static reset(): void {
    FakeEngyChat.reply = 'This is a fake Engy reply.';
    FakeEngyChat.failWith = null;
    FakeEngyChat.seenRequests = [];
    FakeEngyChat.callCount = 0;
  }

  reply(req: EngyChatRequest) {
    FakeEngyChat.callCount += 1;
    FakeEngyChat.seenRequests.push(req);
    if (FakeEngyChat.failWith) {
      return Promise.reject(FakeEngyChat.failWith);
    }
    return Promise.resolve({ reply: FakeEngyChat.reply });
  }
}

describe('Engy Chat (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const createdUserEmails: string[] = [];
  const createdPlacementAttemptIds: string[] = [];
  const createdCourseIds: string[] = [];
  const createdLessonIds: string[] = [];
  const createdVocabWordIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ENGY_CHAT_PROVIDER)
      .useClass(FakeEngyChat)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    await app.init();

    prisma = app.get(PrismaService);
  });

  beforeEach(() => {
    FakeEngyChat.reset();
  });

  afterAll(async () => {
    if (createdPlacementAttemptIds.length) {
      await prisma.placementAttempt.deleteMany({
        where: { id: { in: createdPlacementAttemptIds } },
      });
    }
    if (createdVocabWordIds.length) {
      await prisma.vocabWord.deleteMany({ where: { id: { in: createdVocabWordIds } } });
    }
    if (createdLessonIds.length) {
      await prisma.lesson.deleteMany({ where: { id: { in: createdLessonIds } } });
    }
    if (createdCourseIds.length) {
      await prisma.course.deleteMany({ where: { id: { in: createdCourseIds } } });
    }
    if (createdUserEmails.length) {
      await prisma.user.deleteMany({ where: { email: { in: createdUserEmails } } });
    }
    await app.close();
  });

  async function registerStudent(label: string): Promise<{ token: string; userId: string }> {
    const email = `chat-${label}-${randomUUID()}@example.test`;
    createdUserEmails.push(email);
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: `Chat ${label}`, email, password: 'password123' });
    const token = (res.body as { accessToken?: string }).accessToken;
    const userId = (res.body as { user?: { id?: string } }).user?.id;
    if (!token || !userId) {
      throw new Error(
        `registerStudent('${label}') did not receive accessToken/user.id — register responded ${res.status}: ${JSON.stringify(res.body)}`,
      );
    }
    return { token, userId };
  }

  async function startUnfinishedPlacementAttempt(userId: string): Promise<void> {
    const attempt = await prisma.placementAttempt.create({
      data: {
        userId,
        questionIds: [],
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      },
    });
    createdPlacementAttemptIds.push(attempt.id);
  }

  async function completePlacementAttempt(userId: string): Promise<void> {
    const attempt = await prisma.placementAttempt.create({
      data: {
        userId,
        questionIds: [],
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        completedAt: new Date(),
      },
    });
    createdPlacementAttemptIds.push(attempt.id);
  }

  async function seedPublishedLesson(overrides: {
    notes?: string;
    isPublished?: boolean;
    coursePublished?: boolean;
  } = {}): Promise<string> {
    const course = await prisma.course.create({
      data: {
        title: `Chat Phase C course ${randomUUID()}`,
        type: 'GRAMMAR',
        description: 'Seeded for chat.e2e-spec.ts',
        isPublished: overrides.coursePublished ?? true,
      },
    });
    createdCourseIds.push(course.id);

    const lesson = await prisma.lesson.create({
      data: {
        courseId: course.id,
        title: 'Present Perfect Tense',
        description: 'Learn when to use the present perfect.',
        learningObjectives: ['Recognise the form', 'Use it in a sentence'],
        notes: overrides.notes ?? 'The present perfect is formed with have/has + past participle.',
        orderIndex: 0,
        isPublished: overrides.isPublished ?? true,
      },
    });
    createdLessonIds.push(lesson.id);
    return lesson.id;
  }

  async function seedVocabWord(): Promise<string> {
    const word = await prisma.vocabWord.create({
      data: {
        text: `resign-${randomUUID().slice(0, 8)}`,
        ipa: '/rɪˈzaɪn/',
        source: 'ADMIN',
        meanings: { create: [{ meaning: 'từ chức', orderIndex: 0 }] },
        examples: { create: [{ sentence: 'She resigned from her job.', orderIndex: 0 }] },
      },
    });
    createdVocabWordIds.push(word.id);
    return word.id;
  }

  describe('POST /chat/messages', () => {
    it('rejects an unauthenticated request', async () => {
      await request(app.getHttpServer())
        .post('/chat/messages')
        .send({ clientMessageId: randomUUID(), message: 'hello' })
        .expect(401);
    });

    it('rejects an invalid DTO — missing message', async () => {
      const { token } = await registerStudent('invalid-a');
      await request(app.getHttpServer())
        .post('/chat/messages')
        .set('Authorization', `Bearer ${token}`)
        .send({ clientMessageId: randomUUID() })
        .expect(400);
    });

    it('rejects an invalid DTO — clientMessageId is not a UUID v4', async () => {
      const { token } = await registerStudent('invalid-b');
      await request(app.getHttpServer())
        .post('/chat/messages')
        .set('Authorization', `Bearer ${token}`)
        .send({ clientMessageId: 'not-a-uuid', message: 'hello' })
        .expect(400);
    });

    it('rejects a context type other than GENERAL', async () => {
      const { token } = await registerStudent('invalid-c');
      await request(app.getHttpServer())
        .post('/chat/messages')
        .set('Authorization', `Bearer ${token}`)
        .send({
          clientMessageId: randomUUID(),
          message: 'hello',
          context: { type: 'LESSON' },
        })
        .expect(400);
    });

    it('sends a message and gets Engy\'s reply back', async () => {
      const { token } = await registerStudent('happy');
      FakeEngyChat.reply = 'Hello! How can I help you learn English today?';
      const clientMessageId = randomUUID();

      const res = await request(app.getHttpServer())
        .post('/chat/messages')
        .set('Authorization', `Bearer ${token}`)
        .send({ clientMessageId, message: 'Hi Engy!' })
        .expect(201);

      expect(res.body).toMatchObject({
        clientMessageId,
        reply: 'Hello! How can I help you learn English today?',
      });
      expect(typeof (res.body as { repliedAt: string }).repliedAt).toBe('string');
      expect(FakeEngyChat.callCount).toBe(1);
      expect(FakeEngyChat.seenRequests[0]).toEqual({
        history: [],
        message: 'Hi Engy!',
        context: null,
      });
    });

    it('replaying the same clientMessageId returns the SAME reply and calls Gemini exactly once', async () => {
      const { token } = await registerStudent('replay');
      FakeEngyChat.reply = 'First and only answer.';
      const clientMessageId = randomUUID();

      const first = await request(app.getHttpServer())
        .post('/chat/messages')
        .set('Authorization', `Bearer ${token}`)
        .send({ clientMessageId, message: 'Explain present perfect' })
        .expect(201);

      // Change what the fake WOULD return, to prove the replay is served
      // from the idempotency cache rather than calling the provider again.
      FakeEngyChat.reply = 'A different answer that must NOT be returned.';

      const second = await request(app.getHttpServer())
        .post('/chat/messages')
        .set('Authorization', `Bearer ${token}`)
        .send({ clientMessageId, message: 'Explain present perfect' })
        .expect(201);

      expect(second.body).toEqual(first.body);
      expect(FakeEngyChat.callCount).toBe(1);
    });

    it('an unfinished Placement Attempt returns 403 ASSESSMENT_IN_PROGRESS, never calling Gemini', async () => {
      const { token, userId } = await registerStudent('placement-blocked');
      await startUnfinishedPlacementAttempt(userId);

      const res = await request(app.getHttpServer())
        .post('/chat/messages')
        .set('Authorization', `Bearer ${token}`)
        .send({ clientMessageId: randomUUID(), message: 'hello' })
        .expect(403);

      expect(res.body).toMatchObject({ code: 'ASSESSMENT_IN_PROGRESS' });
      expect(FakeEngyChat.callCount).toBe(0);
    });

    it('a COMPLETED Placement Attempt does not block chat', async () => {
      const { token, userId } = await registerStudent('placement-completed');
      await completePlacementAttempt(userId);

      await request(app.getHttpServer())
        .post('/chat/messages')
        .set('Authorization', `Bearer ${token}`)
        .send({ clientMessageId: randomUUID(), message: 'hello' })
        .expect(201);

      expect(FakeEngyChat.callCount).toBe(1);
    });

    it('exhausting the message rate limit returns 429', async () => {
      const { token } = await registerStudent('rate-limited');

      // max: 20 per 300s (chat-rate-limits.decorator.ts) — the 21st request
      // in the same window must be rejected.
      for (let i = 0; i < 20; i += 1) {
        await request(app.getHttpServer())
          .post('/chat/messages')
          .set('Authorization', `Bearer ${token}`)
          .send({ clientMessageId: randomUUID(), message: `message ${i}` })
          .expect(201);
      }

      await request(app.getHttpServer())
        .post('/chat/messages')
        .set('Authorization', `Bearer ${token}`)
        .send({ clientMessageId: randomUUID(), message: 'one too many' })
        .expect(429);
    }, 30000);

    describe('Phase C — LESSON/VOCAB_WORD context', () => {
      it('rejects a LESSON context with no resourceId', async () => {
        const { token } = await registerStudent('context-invalid-a');
        await request(app.getHttpServer())
          .post('/chat/messages')
          .set('Authorization', `Bearer ${token}`)
          .send({
            clientMessageId: randomUUID(),
            message: 'hello',
            context: { type: 'LESSON' },
          })
          .expect(400);
      });

      it('rejects an invalid stage value', async () => {
        const { token } = await registerStudent('context-invalid-b');
        const lessonId = await seedPublishedLesson();
        await request(app.getHttpServer())
          .post('/chat/messages')
          .set('Authorization', `Bearer ${token}`)
          .send({
            clientMessageId: randomUUID(),
            message: 'hello',
            context: { type: 'LESSON', resourceId: lessonId, stage: 'not-a-real-stage' },
          })
          .expect(400);
      });

      it('a LESSON context at the theory stage includes the theory content in what Gemini receives', async () => {
        const { token } = await registerStudent('context-lesson-theory');
        const lessonId = await seedPublishedLesson();

        await request(app.getHttpServer())
          .post('/chat/messages')
          .set('Authorization', `Bearer ${token}`)
          .send({
            clientMessageId: randomUUID(),
            message: 'Can you explain this more simply?',
            context: { type: 'LESSON', resourceId: lessonId, stage: 'theory' },
          })
          .expect(201);

        const seen = FakeEngyChat.seenRequests[0];
        expect(seen.context).toContain('Present Perfect Tense');
        expect(seen.context).toContain('formed with have/has + past participle');
      });

      it('a LESSON context at the quiz stage never includes lesson.notes — only title/objectives', async () => {
        const { token } = await registerStudent('context-lesson-quiz');
        const lessonId = await seedPublishedLesson();

        await request(app.getHttpServer())
          .post('/chat/messages')
          .set('Authorization', `Bearer ${token}`)
          .send({
            clientMessageId: randomUUID(),
            message: 'hello',
            context: { type: 'LESSON', resourceId: lessonId, stage: 'quiz' },
          })
          .expect(201);

        const seen = FakeEngyChat.seenRequests[0];
        expect(seen.context).toContain('Present Perfect Tense');
        expect(seen.context).not.toContain('formed with have/has + past participle');
      });

      it('a LESSON context for a missing/unpublished lesson 404s, never calling Gemini', async () => {
        const { token } = await registerStudent('context-lesson-404');

        const res = await request(app.getHttpServer())
          .post('/chat/messages')
          .set('Authorization', `Bearer ${token}`)
          .send({
            clientMessageId: randomUUID(),
            message: 'hello',
            context: { type: 'LESSON', resourceId: randomUUID() },
          })
          .expect(404);

        expect(res.body).toBeDefined();
        expect(FakeEngyChat.callCount).toBe(0);
      });

      it('a VOCAB_WORD context includes the curated word info in what Gemini receives', async () => {
        const { token } = await registerStudent('context-vocab');
        const vocabWordId = await seedVocabWord();

        await request(app.getHttpServer())
          .post('/chat/messages')
          .set('Authorization', `Bearer ${token}`)
          .send({
            clientMessageId: randomUUID(),
            message: 'Can you use it in a sentence?',
            context: { type: 'VOCAB_WORD', resourceId: vocabWordId },
          })
          .expect(201);

        const seen = FakeEngyChat.seenRequests[0];
        expect(seen.context).toContain('từ chức');
        expect(seen.context).toContain('She resigned from her job.');
      });

      it('a VOCAB_WORD context for a missing word 404s, never calling Gemini', async () => {
        const { token } = await registerStudent('context-vocab-404');

        await request(app.getHttpServer())
          .post('/chat/messages')
          .set('Authorization', `Bearer ${token}`)
          .send({
            clientMessageId: randomUUID(),
            message: 'hello',
            context: { type: 'VOCAB_WORD', resourceId: randomUUID() },
          })
          .expect(404);

        expect(FakeEngyChat.callCount).toBe(0);
      });
    });
  });

  describe('GET /chat/session', () => {
    it('rejects an unauthenticated request', async () => {
      await request(app.getHttpServer()).get('/chat/session').expect(401);
    });

    it('returns an empty session for a student who has never chatted', async () => {
      const { token } = await registerStudent('empty-session');

      const res = await request(app.getHttpServer())
        .get('/chat/session')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toEqual({ turns: [], expiresAt: null });
    });

    it('restores the bounded history after a message was sent', async () => {
      const { token } = await registerStudent('session-restore');
      FakeEngyChat.reply = 'Sure, here is an example.';

      await request(app.getHttpServer())
        .post('/chat/messages')
        .set('Authorization', `Bearer ${token}`)
        .send({ clientMessageId: randomUUID(), message: 'Give me an example sentence' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get('/chat/session')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = res.body as { turns: { role: string; text: string }[]; expiresAt: string };
      expect(body.turns).toEqual([
        { role: 'user', text: 'Give me an example sentence', at: expect.any(Number) },
        { role: 'assistant', text: 'Sure, here is an example.', at: expect.any(Number) },
      ]);
      expect(typeof body.expiresAt).toBe('string');
    });
  });

  describe('DELETE /chat/session', () => {
    it('rejects an unauthenticated request', async () => {
      await request(app.getHttpServer()).delete('/chat/session').expect(401);
    });

    it('clears the session, and a second call is still a no-op 204', async () => {
      const { token } = await registerStudent('clear-session');
      await request(app.getHttpServer())
        .post('/chat/messages')
        .set('Authorization', `Bearer ${token}`)
        .send({ clientMessageId: randomUUID(), message: 'hello' })
        .expect(201);

      await request(app.getHttpServer())
        .delete('/chat/session')
        .set('Authorization', `Bearer ${token}`)
        .expect(204);

      const res = await request(app.getHttpServer())
        .get('/chat/session')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body).toEqual({ turns: [], expiresAt: null });

      await request(app.getHttpServer())
        .delete('/chat/session')
        .set('Authorization', `Bearer ${token}`)
        .expect(204);
    });
  });
});
