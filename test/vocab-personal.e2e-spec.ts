import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WsAdapter } from '@nestjs/platform-ws';
import request from 'supertest';
import type { App } from 'supertest/types';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

// "Từ vựng của tôi" (My Vocabulary) — /vocab-personal/*.
//
// What only a real, DB-backed, real-DI-graph, real-HTTP test can prove that
// the unit spec (vocab-personal.service.spec.ts) cannot: the routes are
// actually wired behind JwtAuthGuard, DTO validation actually runs (the
// bulk array cap, ParseUUIDPipe on :id), and — the one property this
// feature's whole ownership design exists for — one student genuinely
// cannot read, edit, delete, or review another student's word through the
// real controller, and gets an identical 404 (never a 403 that would
// confirm the id belongs to someone else) whether the id is someone else's
// or simply doesn't exist.
describe('Vocab Personal (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const createdUserEmails: string[] = [];

  const registerAndLogin = async (
    label: string,
  ): Promise<{ token: string; userId: string }> => {
    const email = `vp-${label.slice(0, 18)}-${randomUUID()}@example.test`;
    createdUserEmails.push(email);
    const register = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: `Vocab Personal ${label}`, email, password: 'password123' });
    const userId = (register.body as { user: { id: string } }).user.id;
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'password123', role: 'USER' });
    return { token: (login.body as { accessToken: string }).accessToken, userId };
  };

  const createWord = (token: string, text = `word-${randomUUID().slice(0, 8)}`) =>
    request(app.getHttpServer())
      .post('/vocab-personal/words')
      .set('Authorization', `Bearer ${token}`)
      .send({ text, meaningVi: 'nghĩa tiếng việt' });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    // AppModule includes SpeakingLiveGateway — app.init() over the full
    // module graph needs an explicit WS adapter or it throws.
    app.useWebSocketAdapter(new WsAdapter(app));
    app.useGlobalPipes(new ValidationPipe());
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    if (createdUserEmails.length) {
      await prisma.user.deleteMany({ where: { email: { in: createdUserEmails } } });
    }
    await app.close();
  });

  describe('authentication', () => {
    it('rejects an unauthenticated list request', async () => {
      await request(app.getHttpServer()).get('/vocab-personal/words').expect(401);
    });

    it('rejects an unauthenticated create request', async () => {
      await request(app.getHttpServer())
        .post('/vocab-personal/words')
        .send({ text: 'x', meaningVi: 'y' })
        .expect(401);
    });
  });

  describe('create, list, update, delete — the basic loop', () => {
    it('creates a word, lists it back, updates it, then deletes it', async () => {
      const { token } = await registerAndLogin('loop');

      const created = await createWord(token, 'ubiquitous').expect(201);
      const id = (created.body as { id: string }).id;

      const listed = await request(app.getHttpServer())
        .get('/vocab-personal/words')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect((listed.body as { data: { id: string }[] }).data.some((w) => w.id === id)).toBe(
        true,
      );

      await request(app.getHttpServer())
        .patch(`/vocab-personal/words/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ meaningVi: 'nghĩa mới' })
        .expect(200)
        .expect((res) => {
          expect((res.body as { meaningVi: string }).meaningVi).toBe('nghĩa mới');
        });

      await request(app.getHttpServer())
        .delete(`/vocab-personal/words/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const afterDelete = await request(app.getHttpServer())
        .get('/vocab-personal/words')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(
        (afterDelete.body as { data: { id: string }[] }).data.some((w) => w.id === id),
      ).toBe(false);
    });

    it('rejects a duplicate word (case/whitespace-insensitive) with 409', async () => {
      const { token } = await registerAndLogin('dup');

      await createWord(token, 'Persistent').expect(201);
      await createWord(token, '  persistent  ').expect(409);
    });
  });

  describe('bulk import', () => {
    it('creates the new words and reports the duplicate as skipped, never a 500', async () => {
      const { token } = await registerAndLogin('bulk');
      await createWord(token, 'existing-bulk-word').expect(201);

      const res = await request(app.getHttpServer())
        .post('/vocab-personal/words/bulk')
        .set('Authorization', `Bearer ${token}`)
        .send({
          words: [
            { text: 'EXISTING-BULK-WORD', meaningVi: 'x' },
            { text: 'fresh-bulk-word', meaningVi: 'y' },
          ],
        })
        .expect(201);

      expect(res.body).toEqual({
        createdCount: 1,
        skippedCount: 1,
        skippedWords: ['EXISTING-BULK-WORD'],
      });
    });

    it('rejects a payload over the 200-word cap with 400, not by accepting it', async () => {
      const { token } = await registerAndLogin('bulkcap');
      const words = Array.from({ length: 201 }, (_, i) => ({
        text: `cap-word-${i}`,
        meaningVi: 'x',
      }));

      await request(app.getHttpServer())
        .post('/vocab-personal/words/bulk')
        .set('Authorization', `Bearer ${token}`)
        .send({ words })
        .expect(400);
    });
  });

  describe('GET words/status — batch saved-status check', () => {
    it('reports saved:true with the real id for a saved word and saved:false for an unsaved one', async () => {
      const { token } = await registerAndLogin('status');
      const created = await createWord(token, 'status-check-word').expect(201);
      const id = (created.body as { id: string }).id;

      const res = await request(app.getHttpServer())
        .get('/vocab-personal/words/status')
        .query({ texts: 'status-check-word,never-saved-word' })
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toEqual({
        'status-check-word': { saved: true, id },
        'never-saved-word': { saved: false },
      });
    });

    it('rejects an unauthenticated request', async () => {
      await request(app.getHttpServer())
        .get('/vocab-personal/words/status')
        .query({ texts: 'anything' })
        .expect(401);
    });

    it('rejects a payload over the 100-text cap with 400', async () => {
      const { token } = await registerAndLogin('statuscap');
      const texts = Array.from({ length: 101 }, (_, i) => `cap-${i}`).join(',');

      await request(app.getHttpServer())
        .get('/vocab-personal/words/status')
        .query({ texts })
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });

    it('never reports another user\'s word as saved, even with an identical text', async () => {
      const owner = await registerAndLogin('status-own-a');
      const viewer = await registerAndLogin('status-own-b');
      await createWord(owner.token, 'owner-status-word').expect(201);

      const res = await request(app.getHttpServer())
        .get('/vocab-personal/words/status')
        .query({ texts: 'owner-status-word' })
        .set('Authorization', `Bearer ${viewer.token}`)
        .expect(200);

      expect(res.body).toEqual({ 'owner-status-word': { saved: false } });
    });
  });

  describe('review', () => {
    it('submits a rating and the word advances via the real scheduler', async () => {
      const { token } = await registerAndLogin('review');
      const created = await createWord(token).expect(201);
      const id = (created.body as { id: string }).id;

      const res = await request(app.getHttpServer())
        .post(`/vocab-personal/words/${id}/review`)
        .set('Authorization', `Bearer ${token}`)
        .send({ rating: 'GOOD', clientReviewId: randomUUID() })
        .expect(201);

      expect((res.body as { state: string }).state).toBe('REVIEW');
      expect((res.body as { version: number }).version).toBe(1);
    });
  });

  describe('stats', () => {
    it('reflects a freshly-created word as due today', async () => {
      const { token } = await registerAndLogin('stats');
      await createWord(token).expect(201);

      const res = await request(app.getHttpServer())
        .get('/vocab-personal/stats')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = res.body as { total: number; dueTodayCount: number };
      expect(body.total).toBeGreaterThanOrEqual(1);
      expect(body.dueTodayCount).toBeGreaterThanOrEqual(1);
    });
  });

  // The core ownership property (owner review point B): identical 404s,
  // never a 403 that would confirm another user's word exists.
  describe('ownership isolation', () => {
    it('cannot PATCH another user\'s word — 404, not 403', async () => {
      const owner = await registerAndLogin('own-a');
      const attacker = await registerAndLogin('own-b');
      const created = await createWord(owner.token).expect(201);
      const id = (created.body as { id: string }).id;

      await request(app.getHttpServer())
        .patch(`/vocab-personal/words/${id}`)
        .set('Authorization', `Bearer ${attacker.token}`)
        .send({ meaningVi: 'hacked' })
        .expect(404);
    });

    it('cannot DELETE another user\'s word — 404, not 403', async () => {
      const owner = await registerAndLogin('own-c');
      const attacker = await registerAndLogin('own-d');
      const created = await createWord(owner.token).expect(201);
      const id = (created.body as { id: string }).id;

      await request(app.getHttpServer())
        .delete(`/vocab-personal/words/${id}`)
        .set('Authorization', `Bearer ${attacker.token}`)
        .expect(404);

      // Still there, from the real owner's perspective.
      const stillListed = await request(app.getHttpServer())
        .get('/vocab-personal/words')
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(200);
      expect(
        (stillListed.body as { data: { id: string }[] }).data.some((w) => w.id === id),
      ).toBe(true);
    });

    it('cannot submit a review against another user\'s word — 404, not 403', async () => {
      const owner = await registerAndLogin('own-e');
      const attacker = await registerAndLogin('own-f');
      const created = await createWord(owner.token).expect(201);
      const id = (created.body as { id: string }).id;

      await request(app.getHttpServer())
        .post(`/vocab-personal/words/${id}/review`)
        .set('Authorization', `Bearer ${attacker.token}`)
        .send({ rating: 'GOOD', clientReviewId: randomUUID() })
        .expect(404);
    });

    it('never lists another user\'s words', async () => {
      const owner = await registerAndLogin('own-g');
      const viewer = await registerAndLogin('own-h');
      const created = await createWord(owner.token, 'owner-only-word').expect(201);
      const id = (created.body as { id: string }).id;

      const res = await request(app.getHttpServer())
        .get('/vocab-personal/words')
        .set('Authorization', `Bearer ${viewer.token}`)
        .expect(200);

      expect((res.body as { data: { id: string }[] }).data.some((w) => w.id === id)).toBe(
        false,
      );
    });
  });
});
