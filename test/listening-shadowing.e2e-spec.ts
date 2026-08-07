import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { testFixtureName } from './test-database.util';
import {
  SPEECH_TO_TEXT_PROVIDER,
  SpeechToTextError,
  SpeechToTextProvider,
  SpeechToTextRequest,
} from '../src/listening/shadowing/speech-to-text.provider';
import {
  PRONUNCIATION_FEEDBACK_PROVIDER,
  PronunciationFeedbackError,
  PronunciationFeedbackProvider,
  PronunciationFeedbackRequest,
} from '../src/listening/shadowing/pronunciation-feedback.provider';

// Sprint 11 Phase 4B — Shadowing with server-side speech-to-text (e2e).
//
// >>> THIS SUITE IS THE REASON THE PROVIDER IS BEHIND A TOKEN. <<<
// Every test here replaces the speech engine with a fake. Without that seam the
// write path could only be exercised by making paid, non-deterministic calls to
// an external API from CI — which in practice means it would not be exercised
// at all, and the scoring rules that decide whether a student passes would ship
// untested.
//
// The properties under test are the ones a unit test on the aligner cannot
// reach:
//   1. THE SERVER DECIDES. No request field can assert a transcript or a score.
//   2. THE ENGINE NEVER SEES THE ANSWER. If the reference sentence reached the
//      provider, an LLM would return it verbatim and every student would score
//      100% — with perfect-looking transcripts hiding the failure completely.
//   3. IDEMPOTENCY IS CHECKED BEFORE THE ENGINE IS CALLED, so a retry is free
//      and cannot produce a second, different verdict for one attempt.
//   4. A BAD UPLOAD IS REJECTED BEFORE ANY WORK, paid or otherwise.
//   5. PROVIDER FAILURES ARE DISTINGUISHABLE — outage, timeout and "this audio
//      cannot be decoded" have different recoveries.
//   6. THE WRITE PATH 404s EXACTLY AS THE READ PATH DOES.

/** Enough bytes to clear MIN_AUDIO_BYTES. Content is irrelevant — the fake never decodes it. */
const AUDIO = Buffer.alloc(2048, 7);

/**
 * A speech engine under the test's control.
 *
 * `seenRequests` is what proves property 2: the suite asserts on what the
 * provider was given, not merely on what it returned.
 */
class FakeSpeechToText implements SpeechToTextProvider {
  readonly source = 'GEMINI' as const;
  static transcript = '';
  static failWith: SpeechToTextError | null = null;
  static seenRequests: SpeechToTextRequest[] = [];
  static callCount = 0;

  static reset(): void {
    FakeSpeechToText.transcript = '';
    FakeSpeechToText.failWith = null;
    FakeSpeechToText.seenRequests = [];
    FakeSpeechToText.callCount = 0;
  }

  transcribe(request: SpeechToTextRequest) {
    FakeSpeechToText.callCount += 1;
    FakeSpeechToText.seenRequests.push(request);
    if (FakeSpeechToText.failWith) return Promise.reject(FakeSpeechToText.failWith);
    return Promise.resolve({ transcript: FakeSpeechToText.transcript });
  }
}

/**
 * Sprint 11 Phase 4C — a coaching engine under the test's control.
 *
 * `seenRequests` here proves the OPPOSITE of what it proves for the transcriber:
 * this provider MUST receive the reference sentence, because coaching that does
 * not know the target sentence cannot say which word was mispronounced. That is
 * safe only because nothing it returns is graded — see
 * pronunciation-feedback.provider.ts.
 */
class FakePronunciationFeedback implements PronunciationFeedbackProvider {
  readonly model = 'fake-coach-1';
  static feedback = 'Bạn phát âm tốt, chú ý âm cuối của "kelp".';
  static failWith: PronunciationFeedbackError | null = null;
  static seenRequests: PronunciationFeedbackRequest[] = [];
  static callCount = 0;

  static reset(): void {
    FakePronunciationFeedback.feedback =
      'Bạn phát âm tốt, chú ý âm cuối của "kelp".';
    FakePronunciationFeedback.failWith = null;
    FakePronunciationFeedback.seenRequests = [];
    FakePronunciationFeedback.callCount = 0;
  }

  generate(request: PronunciationFeedbackRequest) {
    FakePronunciationFeedback.callCount += 1;
    FakePronunciationFeedback.seenRequests.push(request);
    if (FakePronunciationFeedback.failWith) {
      return Promise.reject(FakePronunciationFeedback.failWith);
    }
    return Promise.resolve({ feedback: FakePronunciationFeedback.feedback });
  }
}

describe('Listening Shadowing (e2e) — Sprint 11 Phase 4B', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const createdUserEmails: string[] = [];
  let adminToken: string;
  let studentToken: string;
  let studentId: string;
  let categoryId: string;

  const YOUTUBE_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  const SENTENCE = 'The otter wraps her baby in kelp';

  const registerStudent = async (): Promise<{ token: string; id: string }> => {
    const email = `p4b-student-${randomUUID()}@example.test`;
    createdUserEmails.push(email);
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: 'Phase 4B Student', email, password: 'password123' });
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    return { token: (res.body as { accessToken: string }).accessToken, id: user.id };
  };

  const publishRecording = async (
    texts: string[],
    overrides: Record<string, unknown> = {},
  ): Promise<{ contentId: string; segmentIds: string[] }> => {
    const created = await request(app.getHttpServer())
      .post('/listening/manage/contents')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        categoryId,
        title: testFixtureName('Shadowing'),
        level: 'B1',
        mediaType: 'VIDEO',
        mediaProvider: 'YOUTUBE',
        mediaUrl: YOUTUBE_URL,
        sourceName: 'Fixture Channel',
        sourceUrl: 'https://www.youtube.com/@fixture',
        durationMs: 600_000,
        supportedModes: ['SHADOWING'],
        ...overrides,
      })
      .expect(201);
    const contentId = (created.body as { id: string }).id;

    await request(app.getHttpServer())
      .put(`/listening/manage/contents/${contentId}/segments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        segments: texts.map((text, index) => ({
          orderIndex: index,
          text,
          startTimeMs: index * 5_000,
          endTimeMs: index * 5_000 + 4_000,
        })),
      })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/listening/manage/contents/${contentId}/publish`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const segments = await prisma.listeningSegment.findMany({
      where: { contentId },
      orderBy: { orderIndex: 'asc' },
      select: { id: true },
    });
    return { contentId, segmentIds: segments.map((s) => s.id) };
  };

  /** One spoken attempt. `audio` defaults to a plausible WebM clip. */
  const submit = (
    segmentId: string,
    options: {
      clientAttemptId?: string;
      audio?: Buffer | null;
      mime?: string;
      filename?: string;
      durationMs?: number;
      token?: string;
      extraFields?: Record<string, string>;
    } = {},
  ) => {
    const req = request(app.getHttpServer())
      .post(`/listening/segments/${segmentId}/shadowing/attempts`)
      .set('Authorization', `Bearer ${options.token ?? studentToken}`)
      .field('clientAttemptId', options.clientAttemptId ?? randomUUID());

    if (options.durationMs !== undefined) {
      req.field('durationMs', String(options.durationMs));
    }
    Object.entries(options.extraFields ?? {}).forEach(([key, value]) => {
      req.field(key, value);
    });
    if (options.audio !== null) {
      req.attach('audio', options.audio ?? AUDIO, {
        filename: options.filename ?? 'take.webm',
        contentType: options.mime ?? 'audio/webm;codecs=opus',
      });
    }
    return req;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SPEECH_TO_TEXT_PROVIDER)
      .useClass(FakeSpeechToText)
      .overrideProvider(PRONUNCIATION_FEEDBACK_PROVIDER)
      .useClass(FakePronunciationFeedback)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    await app.init();

    prisma = app.get(PrismaService);

    const adminEmail = `p4b-admin-${randomUUID()}@example.test`;
    createdUserEmails.push(adminEmail);
    const adminRes = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: 'Phase 4B Admin', email: adminEmail, password: 'password123' });
    await prisma.user.update({
      where: { email: adminEmail },
      data: { role: 'ADMIN' },
    });
    // Re-login so the token carries the ADMIN role rather than the one it was
    // registered with.
    const adminLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: adminEmail, password: 'password123', role: 'ADMIN' });
    adminToken = (adminLogin.body as { accessToken: string }).accessToken;
    void adminRes;

    const category = await request(app.getHttpServer())
      .post('/listening/manage/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: testFixtureName('Shadowing Category'),
        nameVi: 'Luyện nói',
        orderIndex: 0,
      })
      .expect(201);
    categoryId = (category.body as { id: string }).id;
    await request(app.getHttpServer())
      .patch(`/listening/manage/categories/${categoryId}/publish`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const student = await registerStudent();
    studentToken = student.token;
    studentId = student.id;
  });

  // A FRESH STUDENT PER TEST. The `speech` rate limit is keyed per user and is
  // deliberately tight — every request in that bucket costs money at an
  // external provider — so a suite of thirty submissions under one account
  // exhausts it and starts asserting 429s instead of behaviour. Registering
  // per test isolates the bucket without weakening the production limit to
  // suit the tests, which would be the wrong way round.
  beforeEach(async () => {
    FakeSpeechToText.reset();
    FakePronunciationFeedback.reset();
    const student = await registerStudent();
    studentToken = student.token;
    studentId = student.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('the engine is never told the answer', () => {
    // THE MOST IMPORTANT TEST IN THIS FILE. If the reference sentence reached
    // the provider, a language model would echo it back, every student would
    // score 100%, and nothing in the response would look wrong.
    it('sends the provider audio and a language only — never the reference text', async () => {
      const { segmentIds } = await publishRecording([SENTENCE]);
      FakeSpeechToText.transcript = SENTENCE;

      await submit(segmentIds[0]).expect(201);

      expect(FakeSpeechToText.seenRequests).toHaveLength(1);
      const seen = FakeSpeechToText.seenRequests[0];
      expect(Object.keys(seen).sort()).toEqual(['audio', 'languageCode', 'mimeType']);
      // Serialised in full, so a reference smuggled inside any field is caught
      // rather than only a top-level `reference` property.
      const serialised = JSON.stringify({
        mimeType: seen.mimeType,
        languageCode: seen.languageCode,
      });
      expect(serialised.toLowerCase()).not.toContain('otter');
    });

    it('passes the audio through unchanged', async () => {
      const { segmentIds } = await publishRecording([SENTENCE]);

      await submit(segmentIds[0]).expect(201);

      expect(FakeSpeechToText.seenRequests[0].audio.equals(AUDIO)).toBe(true);
      expect(FakeSpeechToText.seenRequests[0].mimeType).toContain('audio/webm');
    });
  });

  describe('the server decides the score', () => {
    it('grades a perfect reading as passed', async () => {
      const { segmentIds } = await publishRecording([SENTENCE]);
      FakeSpeechToText.transcript = 'The otter wraps her baby in kelp.';

      const res = await submit(segmentIds[0]).expect(201);

      expect(res.body).toMatchObject({
        accuracyPercent: 100,
        wordsCorrect: 7,
        wordsTotal: 7,
        passed: true,
        substitutions: 0,
        insertions: 0,
        deletions: 0,
      });
      expect(res.body.transcript).toBe('The otter wraps her baby in kelp.');
      expect(res.body.alignment).toHaveLength(7);
    });

    it('fails a reading that is not close enough and does not complete the sentence', async () => {
      const { segmentIds } = await publishRecording([SENTENCE]);
      FakeSpeechToText.transcript = 'the otter';

      const res = await submit(segmentIds[0]).expect(201);

      expect(res.body.passed).toBe(false);
      expect(res.body.deletions).toBe(5);
      expect(res.body.segment.completedAt).toBeNull();
    });

    // The transcript is untrusted input from an external service, and it is
    // the ONLY thing a determined student could influence. Nothing in the
    // request can substitute for it.
    it('ignores a transcript, an accuracy and a pass flag sent in the body', async () => {
      const { segmentIds } = await publishRecording([SENTENCE]);
      FakeSpeechToText.transcript = 'the otter';

      const res = await submit(segmentIds[0], {
        extraFields: {
          transcript: SENTENCE,
          accuracyPercent: '100',
          passed: 'true',
          wordsCorrect: '7',
        },
      }).expect(201);

      expect(res.body.accuracyPercent).toBeLessThan(100);
      expect(res.body.passed).toBe(false);
    });

    it('records the threshold each attempt was judged against', async () => {
      const { segmentIds } = await publishRecording([SENTENCE]);
      FakeSpeechToText.transcript = SENTENCE;

      const res = await submit(segmentIds[0]).expect(201);

      expect(res.body.passThresholdPercent).toBeGreaterThan(0);
      const row = await prisma.listeningShadowingAttempt.findFirstOrThrow({
        where: { userId: studentId, segmentId: segmentIds[0] },
      });
      expect(row.passThresholdPercent).toBe(res.body.passThresholdPercent);
    });

    it('stores no audio anywhere on the attempt row', async () => {
      const { segmentIds } = await publishRecording([SENTENCE]);
      FakeSpeechToText.transcript = SENTENCE;

      await submit(segmentIds[0], { durationMs: 4200 }).expect(201);

      const row = await prisma.listeningShadowingAttempt.findFirstOrThrow({
        where: { userId: studentId, segmentId: segmentIds[0] },
      });
      // The transcript survives; the voice does not. There is no column that
      // could hold it, which is the guarantee — not a deletion step.
      expect(Object.keys(row)).not.toContain('audioUrl');
      expect(JSON.stringify(row)).not.toContain(AUDIO.toString('base64').slice(0, 32));
      expect(row.durationMs).toBe(4200);
    });
  });

  describe('progress', () => {
    it('keeps the best accuracy and never lowers it on a worse retry', async () => {
      const { segmentIds } = await publishRecording([SENTENCE]);

      FakeSpeechToText.transcript = SENTENCE;
      await submit(segmentIds[0]).expect(201);
      FakeSpeechToText.transcript = 'the otter';
      const worse = await submit(segmentIds[0]).expect(201);

      expect(worse.body.accuracyPercent).toBeLessThan(100);
      expect(worse.body.segment.bestAccuracyPercent).toBe(100);
      expect(worse.body.segment.attemptCount).toBe(2);
    });

    it('does not un-pass a sentence that was already passed', async () => {
      const { segmentIds } = await publishRecording([SENTENCE]);

      FakeSpeechToText.transcript = SENTENCE;
      const first = await submit(segmentIds[0]).expect(201);
      expect(first.body.segment.completedAt).not.toBeNull();

      FakeSpeechToText.transcript = 'nothing like it';
      const second = await submit(segmentIds[0]).expect(201);

      expect(second.body.passed).toBe(false);
      expect(second.body.segment.completedAt).not.toBeNull();
    });

    it('surfaces per-sentence progress on the content read', async () => {
      const { contentId, segmentIds } = await publishRecording([SENTENCE, 'Kelp is slippery']);
      FakeSpeechToText.transcript = SENTENCE;
      await submit(segmentIds[0]).expect(201);

      const res = await request(app.getHttpServer())
        .get(`/listening/contents/${contentId}`)
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(200);

      expect(res.body.shadowingProgress).toHaveLength(1);
      expect(res.body.shadowingProgress[0].segmentId).toBe(segmentIds[0]);
      // Dictation is not enabled on this recording, and "off" is not "none done".
      expect(res.body.dictationProgress).toBeNull();
    });

    it('keeps one student out of another student\'s progress', async () => {
      const { contentId, segmentIds } = await publishRecording([SENTENCE]);
      FakeSpeechToText.transcript = SENTENCE;
      await submit(segmentIds[0]).expect(201);

      const other = await registerStudent();
      const res = await request(app.getHttpServer())
        .get(`/listening/contents/${contentId}`)
        .set('Authorization', `Bearer ${other.token}`)
        .expect(200);

      expect(res.body.shadowingProgress).toEqual([]);
    });
  });

  describe('catalog batch progress — GET /listening/shadowing/progress', () => {
    it('reports totals and completion derived from the live segment list', async () => {
      const { contentId, segmentIds } = await publishRecording([
        SENTENCE,
        'Kelp is slippery',
      ]);
      FakeSpeechToText.transcript = SENTENCE;
      await submit(segmentIds[0]).expect(201);

      const res = await request(app.getHttpServer())
        .get(`/listening/shadowing/progress?contentIds=${contentId}`)
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(200);

      expect(res.body).toEqual([
        {
          contentId,
          shadowing: {
            totalSegments: 2,
            completedSegments: 1,
            completed: false,
            lastActivityAt: expect.any(String),
          },
        },
      ]);
    });

    it('is null for a recording that does not enable SHADOWING', async () => {
      const { contentId } = await publishRecording([SENTENCE], {
        supportedModes: ['DICTATION'],
      });

      const res = await request(app.getHttpServer())
        .get(`/listening/shadowing/progress?contentIds=${contentId}`)
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(200);

      expect(res.body).toEqual([{ contentId, shadowing: null }]);
    });

    it('keeps one student out of another student\'s progress', async () => {
      const { contentId, segmentIds } = await publishRecording([SENTENCE]);
      FakeSpeechToText.transcript = SENTENCE;
      await submit(segmentIds[0]).expect(201);

      const other = await registerStudent();
      const res = await request(app.getHttpServer())
        .get(`/listening/shadowing/progress?contentIds=${contentId}`)
        .set('Authorization', `Bearer ${other.token}`)
        .expect(200);

      expect(res.body).toEqual([
        { contentId, shadowing: { totalSegments: 1, completedSegments: 0, completed: false, lastActivityAt: null } },
      ]);
    });

    it('omits an id the student cannot see rather than failing the whole batch', async () => {
      const { contentId } = await publishRecording([SENTENCE]);
      const draft = await request(app.getHttpServer())
        .post('/listening/manage/contents')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          categoryId,
          title: testFixtureName('Draft Shadowing'),
          level: 'B1',
          mediaType: 'VIDEO',
          mediaProvider: 'YOUTUBE',
          mediaUrl: YOUTUBE_URL,
          supportedModes: ['SHADOWING'],
        })
        .expect(201);
      const draftId = (draft.body as { id: string }).id;

      const res = await request(app.getHttpServer())
        .get(`/listening/shadowing/progress?contentIds=${contentId},${draftId}`)
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(200);

      expect((res.body as Array<{ contentId: string }>).map((row) => row.contentId)).toEqual([
        contentId,
      ]);
    });

    it('401s without a token', async () => {
      const { contentId } = await publishRecording([SENTENCE]);
      await request(app.getHttpServer())
        .get(`/listening/shadowing/progress?contentIds=${contentId}`)
        .expect(401);
    });
  });

  describe('idempotency', () => {
    // The engine is not called again. That is the point: transcription costs
    // money and is not guaranteed to return the same text twice, so a replay
    // must return the ORIGINAL verdict rather than buy a second opinion.
    it('replays the original result without calling the engine again', async () => {
      const { segmentIds } = await publishRecording([SENTENCE]);
      FakeSpeechToText.transcript = SENTENCE;
      const attemptId = randomUUID();

      const first = await submit(segmentIds[0], { clientAttemptId: attemptId }).expect(201);
      expect(FakeSpeechToText.callCount).toBe(1);

      FakeSpeechToText.transcript = 'completely different words';
      const replay = await submit(segmentIds[0], { clientAttemptId: attemptId }).expect(201);

      expect(FakeSpeechToText.callCount).toBe(1);
      expect(replay.body.transcript).toBe(first.body.transcript);
      expect(replay.body.accuracyPercent).toBe(first.body.accuracyPercent);
      expect(replay.body.passed).toBe(first.body.passed);
    });

    it('creates no second attempt row and does not inflate the count', async () => {
      const { segmentIds } = await publishRecording([SENTENCE]);
      FakeSpeechToText.transcript = SENTENCE;
      const attemptId = randomUUID();

      await submit(segmentIds[0], { clientAttemptId: attemptId }).expect(201);
      await submit(segmentIds[0], { clientAttemptId: attemptId }).expect(201);

      const rows = await prisma.listeningShadowingAttempt.count({
        where: { userId: studentId, clientAttemptId: attemptId },
      });
      expect(rows).toBe(1);
      const progress = await prisma.listeningShadowingSegmentProgress.findFirstOrThrow({
        where: { userId: studentId, segmentId: segmentIds[0] },
      });
      expect(progress.attemptCount).toBe(1);
    });

    it('scopes the key per student, so two students may reuse one id', async () => {
      const { segmentIds } = await publishRecording([SENTENCE]);
      FakeSpeechToText.transcript = SENTENCE;
      const shared = randomUUID();
      const other = await registerStudent();

      await submit(segmentIds[0], { clientAttemptId: shared }).expect(201);
      await submit(segmentIds[0], {
        clientAttemptId: shared,
        token: other.token,
      }).expect(201);

      expect(FakeSpeechToText.callCount).toBe(2);
    });
  });

  describe('the upload is checked before any work is done', () => {
    it('rejects a request with no audio at all', async () => {
      const { segmentIds } = await publishRecording([SENTENCE]);

      await submit(segmentIds[0], { audio: null }).expect(400);

      expect(FakeSpeechToText.callCount).toBe(0);
    });

    // The Phase 3 failure exactly: a WebM container header with no audio in
    // it. Not zero bytes, which is why a `size === 0` check never caught it.
    it('rejects a container header with no audio in it', async () => {
      const { segmentIds } = await publishRecording([SENTENCE]);

      await submit(segmentIds[0], { audio: Buffer.alloc(110, 1) }).expect(400);

      expect(FakeSpeechToText.callCount).toBe(0);
    });

    it('rejects a format it cannot send for transcription', async () => {
      const { segmentIds } = await publishRecording([SENTENCE]);

      await submit(segmentIds[0], {
        mime: 'application/zip',
        filename: 'take.zip',
      }).expect(400);

      expect(FakeSpeechToText.callCount).toBe(0);
    });

    // Codec parameters vary by browser and must not decide whether a valid
    // recording is accepted.
    it('accepts a browser mime string with codec parameters', async () => {
      const { segmentIds } = await publishRecording([SENTENCE]);
      FakeSpeechToText.transcript = SENTENCE;

      await submit(segmentIds[0], { mime: 'audio/webm;codecs=opus' }).expect(201);
      await submit(segmentIds[0], {
        mime: 'audio/mp4;codecs=mp4a.40.2',
        filename: 'take.m4a',
      }).expect(201);
    });

    it('rejects a missing idempotency key rather than inventing one', async () => {
      const { segmentIds } = await publishRecording([SENTENCE]);

      await request(app.getHttpServer())
        .post(`/listening/segments/${segmentIds[0]}/shadowing/attempts`)
        .set('Authorization', `Bearer ${studentToken}`)
        .attach('audio', AUDIO, { filename: 'take.webm', contentType: 'audio/webm' })
        .expect(400);

      expect(FakeSpeechToText.callCount).toBe(0);
    });
  });

  describe('provider failures stay distinguishable', () => {
    it('reports an outage as 503, and consumes no attempt', async () => {
      const { segmentIds } = await publishRecording([SENTENCE]);
      FakeSpeechToText.failWith = new SpeechToTextError('UNAVAILABLE', 'down');

      await submit(segmentIds[0]).expect(503);

      const rows = await prisma.listeningShadowingAttempt.count({
        where: { userId: studentId, segmentId: segmentIds[0] },
      });
      expect(rows).toBe(0);
    });

    it('reports a timeout as 503 as well — the student can do nothing about either', async () => {
      const { segmentIds } = await publishRecording([SENTENCE]);
      FakeSpeechToText.failWith = new SpeechToTextError('TIMEOUT', 'slow');

      await submit(segmentIds[0]).expect(503);
    });

    // Undecodable audio is the student's recording, not our outage, and the
    // recovery is "record again" rather than "try again in a moment".
    it('reports undecodable audio as 400, not as an outage', async () => {
      const { segmentIds } = await publishRecording([SENTENCE]);
      FakeSpeechToText.failWith = new SpeechToTextError('UNSUPPORTED_AUDIO', 'bad');

      await submit(segmentIds[0]).expect(400);
    });

    it('treats a missing API key as an outage from the student\'s side', async () => {
      const { segmentIds } = await publishRecording([SENTENCE]);
      FakeSpeechToText.failWith = new SpeechToTextError('NOT_CONFIGURED', 'no key');

      await submit(segmentIds[0]).expect(503);
    });

    // Silence is a RESULT, not an error. "You were not heard" is something the
    // student can act on; hiding it behind a retry prompt is not.
    it('scores an empty transcript rather than raising', async () => {
      const { segmentIds } = await publishRecording([SENTENCE]);
      FakeSpeechToText.transcript = '';

      const res = await submit(segmentIds[0]).expect(201);

      expect(res.body.accuracyPercent).toBe(0);
      expect(res.body.passed).toBe(false);
      expect(res.body.deletions).toBe(7);
    });
  });

  describe('visibility — the write path 404s exactly as the read path does', () => {
    it('404s on a draft recording', async () => {
      const created = await request(app.getHttpServer())
        .post('/listening/manage/contents')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          categoryId,
          title: testFixtureName('Draft Shadowing'),
          level: 'B1',
          mediaType: 'VIDEO',
          mediaProvider: 'YOUTUBE',
          mediaUrl: YOUTUBE_URL,
          sourceName: 'Fixture Channel',
          sourceUrl: 'https://www.youtube.com/@fixture',
          supportedModes: ['SHADOWING'],
        })
        .expect(201);
      const contentId = (created.body as { id: string }).id;
      await request(app.getHttpServer())
        .put(`/listening/manage/contents/${contentId}/segments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          segments: [
            { orderIndex: 0, text: SENTENCE, startTimeMs: 0, endTimeMs: 4000 },
          ],
        })
        .expect(200);
      const segment = await prisma.listeningSegment.findFirstOrThrow({
        where: { contentId },
      });

      await submit(segment.id).expect(404);
      expect(FakeSpeechToText.callCount).toBe(0);
    });

    it('404s when the recording does not enable SHADOWING', async () => {
      const { segmentIds } = await publishRecording([SENTENCE], {
        supportedModes: ['DICTATION'],
      });

      await submit(segmentIds[0]).expect(404);
      expect(FakeSpeechToText.callCount).toBe(0);
    });

    it('401s without a token', async () => {
      const { segmentIds } = await publishRecording([SENTENCE]);

      await request(app.getHttpServer())
        .post(`/listening/segments/${segmentIds[0]}/shadowing/attempts`)
        .field('clientAttemptId', randomUUID())
        .attach('audio', AUDIO, { filename: 'take.webm', contentType: 'audio/webm' })
        .expect(401);
    });
  });

  describe('content lifecycle', () => {
    // The guard exists since Phase 1 and Phase 4A armed it for Dictation.
    // Shadowing progress must arm it too, or a recording students have spoken
    // into is deletable while one they typed into is not.
    it('refuses to delete a recording a student has practised', async () => {
      const { contentId, segmentIds } = await publishRecording([SENTENCE]);
      FakeSpeechToText.transcript = SENTENCE;
      await submit(segmentIds[0]).expect(201);

      const res = await request(app.getHttpServer())
        .delete(`/listening/manage/contents/${contentId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
    });
  });
  // -------------------------------------------------------------------------
  // Sprint 11 Phase 4C — AI pronunciation feedback.
  //
  // The properties under test are the ones that keep this from corrupting the
  // thing it sits next to:
  //   1. IT CHANGES NO SCORE. Not on success, not on failure.
  //   2. THE REFERENCE SENTENCE AND THE TRANSCRIPT COME FROM THE SERVER'S OWN
  //      ROW, never from the request — a client cannot put words in the
  //      coach's mouth, and cannot supply the feedback itself.
  //   3. A SECOND PRESS IS FREE and returns the SAME advice. This one costs
  //      money and is not deterministic; coaching that changes its mind on a
  //      re-read is worse than none.
  //   4. THE RESPONSE CARRIES NO NUMBER. There is exactly one figure for an
  //      attempt and it came from the alignment.
  // -------------------------------------------------------------------------
  describe('AI pronunciation feedback', () => {
    const requestFeedback = (
      segmentId: string,
      options: {
        clientAttemptId: string;
        audio?: Buffer | null;
        mime?: string;
        token?: string;
      },
    ) => {
      const req = request(app.getHttpServer())
        .post(`/listening/segments/${segmentId}/shadowing/feedback`)
        .set('Authorization', `Bearer ${options.token ?? studentToken}`)
        .field('clientAttemptId', options.clientAttemptId);
      if (options.audio !== null) {
        req.attach('audio', options.audio ?? AUDIO, {
          filename: 'take.webm',
          contentType: options.mime ?? 'audio/webm;codecs=opus',
        });
      }
      return req;
    };

    /** One graded attempt, ready to ask for coaching on. */
    const gradedAttempt = async (
      transcript = 'The otter wraps her baby in kelp',
    ): Promise<{ segmentId: string; clientAttemptId: string }> => {
      const { segmentIds } = await publishRecording([SENTENCE]);
      FakeSpeechToText.transcript = transcript;
      const clientAttemptId = randomUUID();
      await submit(segmentIds[0], { clientAttemptId }).expect(201);
      return { segmentId: segmentIds[0], clientAttemptId };
    };

    it('returns coaching prose for an attempt the student made', async () => {
      const { segmentId, clientAttemptId } = await gradedAttempt();

      const res = await requestFeedback(segmentId, { clientAttemptId }).expect(201);

      expect(res.body).toEqual({
        feedback: FakePronunciationFeedback.feedback,
        generatedAt: expect.any(String),
        model: 'fake-coach-1',
        cached: false,
      });
    });

    // THE RESPONSE HAS NO NUMBER IN IT, and this asserts the whole shape rather
    // than the absence of one field: a score invented by a model, sitting
    // beside a real one computed from the alignment, is indistinguishable to a
    // student and wrong.
    it('returns no score, rating or percentage of any kind', async () => {
      const { segmentId, clientAttemptId } = await gradedAttempt();

      const res = await requestFeedback(segmentId, { clientAttemptId }).expect(201);

      expect(Object.keys(res.body as object).sort()).toEqual([
        'cached',
        'feedback',
        'generatedAt',
        'model',
      ]);
    });

    // The ALLOWED direction. The transcriber must never be told the answer;
    // this one must be, or it cannot say which word went wrong.
    it('gives the engine the stored sentence and transcript, not the request', async () => {
      const { segmentId, clientAttemptId } =
        await gradedAttempt('The otter wraps her baby');

      await requestFeedback(segmentId, { clientAttemptId }).expect(201);

      expect(FakePronunciationFeedback.seenRequests).toHaveLength(1);
      const seen = FakePronunciationFeedback.seenRequests[0];
      expect(seen.referenceText).toBe(SENTENCE);
      expect(seen.transcript).toBe('The otter wraps her baby');
      expect(seen.audio).toBeInstanceOf(Buffer);
    });

    it('returns the same advice on a second press, without calling the engine again', async () => {
      const { segmentId, clientAttemptId } = await gradedAttempt();
      const first = await requestFeedback(segmentId, { clientAttemptId }).expect(201);

      FakePronunciationFeedback.feedback = 'A completely different second opinion.';
      const second = await requestFeedback(segmentId, { clientAttemptId }).expect(201);

      expect(FakePronunciationFeedback.callCount).toBe(1);
      expect((second.body as { feedback: string }).feedback).toBe(
        (first.body as { feedback: string }).feedback,
      );
      expect((second.body as { cached: boolean }).cached).toBe(true);
    });

    it('stores the advice on the attempt, with the engine that wrote it', async () => {
      const { segmentId, clientAttemptId } = await gradedAttempt();

      await requestFeedback(segmentId, { clientAttemptId }).expect(201);

      const row = await prisma.listeningShadowingAttempt.findUniqueOrThrow({
        where: { userId_clientAttemptId: { userId: studentId, clientAttemptId } },
        select: { aiFeedback: true, aiFeedbackAt: true, aiFeedbackModel: true },
      });
      expect(row.aiFeedback).toBe(FakePronunciationFeedback.feedback);
      expect(row.aiFeedbackModel).toBe('fake-coach-1');
      expect(row.aiFeedbackAt).toBeInstanceOf(Date);
    });

    // >>> THE ONE THAT MATTERS MOST. <<<
    it('leaves the verdict and the progress row untouched', async () => {
      const { segmentId, clientAttemptId } = await gradedAttempt();
      const before = await prisma.listeningShadowingAttempt.findUniqueOrThrow({
        where: { userId_clientAttemptId: { userId: studentId, clientAttemptId } },
        select: { accuracyPercent: true, passed: true, wordsCorrect: true },
      });
      const progressBefore =
        await prisma.listeningShadowingSegmentProgress.findUniqueOrThrow({
          where: { userId_segmentId: { userId: studentId, segmentId } },
          select: {
            bestAccuracyPercent: true,
            attemptCount: true,
            completedAt: true,
          },
        });

      await requestFeedback(segmentId, { clientAttemptId }).expect(201);

      const after = await prisma.listeningShadowingAttempt.findUniqueOrThrow({
        where: { userId_clientAttemptId: { userId: studentId, clientAttemptId } },
        select: { accuracyPercent: true, passed: true, wordsCorrect: true },
      });
      const progressAfter =
        await prisma.listeningShadowingSegmentProgress.findUniqueOrThrow({
          where: { userId_segmentId: { userId: studentId, segmentId } },
          select: {
            bestAccuracyPercent: true,
            attemptCount: true,
            completedAt: true,
          },
        });
      expect(after).toEqual(before);
      expect(progressAfter).toEqual(progressBefore);
    });

    it('404s for an attempt key that does not exist', async () => {
      const { segmentId } = await gradedAttempt();

      await requestFeedback(segmentId, { clientAttemptId: randomUUID() }).expect(404);
      expect(FakePronunciationFeedback.callCount).toBe(0);
    });

    // A body and a route that disagree describe an attempt that does not exist.
    it('404s when the attempt belongs to a different sentence', async () => {
      const { clientAttemptId } = await gradedAttempt();
      const other = await publishRecording([SENTENCE]);

      await requestFeedback(other.segmentIds[0], { clientAttemptId }).expect(404);
    });

    it('404s for an attempt made by another student rather than coaching on it', async () => {
      const { segmentId, clientAttemptId } = await gradedAttempt();
      const intruder = await registerStudent();

      await requestFeedback(segmentId, {
        clientAttemptId,
        token: intruder.token,
      }).expect(404);
      expect(FakePronunciationFeedback.callCount).toBe(0);
    });

    it('rejects a request with no audio before any paid work', async () => {
      const { segmentId, clientAttemptId } = await gradedAttempt();

      await requestFeedback(segmentId, { clientAttemptId, audio: null }).expect(400);
      expect(FakePronunciationFeedback.callCount).toBe(0);
    });

    it('rejects a container with no audio in it', async () => {
      const { segmentId, clientAttemptId } = await gradedAttempt();

      await requestFeedback(segmentId, {
        clientAttemptId,
        audio: Buffer.alloc(110, 1),
      }).expect(400);
      expect(FakePronunciationFeedback.callCount).toBe(0);
    });

    it('reports an outage as 503 and keeps the score intact', async () => {
      const { segmentId, clientAttemptId } = await gradedAttempt();
      FakePronunciationFeedback.failWith = new PronunciationFeedbackError(
        'UNAVAILABLE',
        'down',
      );

      await requestFeedback(segmentId, { clientAttemptId }).expect(503);

      const row = await prisma.listeningShadowingAttempt.findUniqueOrThrow({
        where: { userId_clientAttemptId: { userId: studentId, clientAttemptId } },
        select: { accuracyPercent: true, aiFeedback: true },
      });
      expect(row.aiFeedback).toBeNull();
      expect(row.accuracyPercent).toBe(100);
    });

    it('reports a missing API key as 503, not as a crash', async () => {
      const { segmentId, clientAttemptId } = await gradedAttempt();
      FakePronunciationFeedback.failWith = new PronunciationFeedbackError(
        'NOT_CONFIGURED',
        'no key',
      );

      await requestFeedback(segmentId, { clientAttemptId }).expect(503);
    });

    // A different recovery: this one means "record again", not "wait".
    it('reports undecodable audio as 400', async () => {
      const { segmentId, clientAttemptId } = await gradedAttempt();
      FakePronunciationFeedback.failWith = new PronunciationFeedbackError(
        'UNSUPPORTED_AUDIO',
        'cannot decode',
      );

      await requestFeedback(segmentId, { clientAttemptId }).expect(400);
    });

    it('refuses an unauthenticated request', async () => {
      const { segmentId, clientAttemptId } = await gradedAttempt();

      await request(app.getHttpServer())
        .post(`/listening/segments/${segmentId}/shadowing/feedback`)
        .field('clientAttemptId', clientAttemptId)
        .attach('audio', AUDIO, { filename: 'take.webm', contentType: 'audio/webm' })
        .expect(401);
    });
  });
});
