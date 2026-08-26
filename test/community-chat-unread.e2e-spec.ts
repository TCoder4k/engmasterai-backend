import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WsAdapter } from '@nestjs/platform-ws';
import request from 'supertest';
import type { App } from 'supertest/types';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

// Community Chat unread badge (2026-08-26) — GET /community/messages/unread-count
// and POST /community/messages/read, against a real database. The unit spec
// (community-chat.service.spec.ts) proves the query shapes with mocks; this
// proves the actual multi-user counting sequence the product owner asked to
// see encoded directly: a fresh user starts at 0 (not "all of history"), a
// new message from someone else increments it, marking read zeroes it, your
// own messages never count, and a third user's messages are counted
// independently per-viewer.
describe('Community Chat unread count (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const createdUserEmails: string[] = [];

  const registerAndLogin = async (
    label: string,
  ): Promise<{ token: string; userId: string }> => {
    const email = `community-unread-${label}-${randomUUID()}@example.test`;
    createdUserEmails.push(email);
    const register = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: `Community ${label}`, email, password: 'password123' });
    const userId = (register.body as { user: { id: string } }).user.id;
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'password123', role: 'USER' });
    return {
      token: (login.body as { accessToken: string }).accessToken,
      userId,
    };
  };

  const send = (token: string, content: string) =>
    request(app.getHttpServer())
      .post('/community/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({ clientMessageId: randomUUID(), content });

  const unreadCount = async (token: string): Promise<number> => {
    const res = await request(app.getHttpServer())
      .get('/community/messages/unread-count')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return (res.body as { count: number }).count;
  };

  const markRead = (token: string) =>
    request(app.getHttpServer())
      .post('/community/messages/read')
      .set('Authorization', `Bearer ${token}`)
      .expect(201); // NestJS's default POST status — no @HttpCode override on this route

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

  it('a fresh user who has never opened Tán gẫu starts at 0, not "all of history"', async () => {
    const a = await registerAndLogin('a1');
    await send(a.token, 'hello before B ever existed');

    const b = await registerAndLogin('b1');

    expect(await unreadCount(b.token)).toBe(0);
  });

  it('a new message from someone else increments the count', async () => {
    const a = await registerAndLogin('a2');
    const b = await registerAndLogin('b2');
    await unreadCount(b.token); // lazily creates B's read-state cursor at "now"

    await send(a.token, 'new message after B joined');

    expect(await unreadCount(b.token)).toBe(1);
  });

  it('marking read zeroes the count, and it stays zero on an immediate re-check', async () => {
    const a = await registerAndLogin('a3');
    const b = await registerAndLogin('b3');
    await unreadCount(b.token);
    await send(a.token, 'one unread message');
    expect(await unreadCount(b.token)).toBe(1);

    await markRead(b.token);

    expect(await unreadCount(b.token)).toBe(0);
  });

  it('never counts your own messages', async () => {
    const b = await registerAndLogin('b4');
    await unreadCount(b.token);

    await send(b.token, 'my own message');

    expect(await unreadCount(b.token)).toBe(0);
  });

  it('counts every other participant, not just one — three users, one viewer', async () => {
    const a = await registerAndLogin('a5');
    const b = await registerAndLogin('b5');
    const c = await registerAndLogin('c5');
    await unreadCount(b.token);

    await send(a.token, 'from A');
    await send(b.token, 'from B (own — must not count)');
    await send(c.token, 'from C');

    expect(await unreadCount(b.token)).toBe(2);
  });

  it('markRead is safe to call repeatedly and never regresses the cursor backward', async () => {
    const a = await registerAndLogin('a6');
    const b = await registerAndLogin('b6');
    await unreadCount(b.token);
    await send(a.token, 'unread #1');

    await markRead(b.token);
    await markRead(b.token);
    await markRead(b.token);
    expect(await unreadCount(b.token)).toBe(0);

    await send(a.token, 'unread #2, after repeated mark-read calls');
    expect(await unreadCount(b.token)).toBe(1);
  });
});
