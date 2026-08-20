import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WsAdapter } from '@nestjs/platform-ws';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

// Phase 3 — GET /health/live and GET /health/ready. Runs against the real
// test Postgres + Redis (same as every other e2e suite here), so this
// covers the "both dependencies genuinely reachable" path end to end;
// health.service.spec.ts (unit, mocked) covers the down/timeout branches
// that aren't practical to induce against real infra in an e2e run.
describe('Health (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // AppModule includes SpeakingLiveGateway — app.init() over the full module graph needs an explicit WS adapter (plain 'ws', not the socket.io default) or it throws. See learning.service.spec.ts's own comment.
    app.useWebSocketAdapter(new WsAdapter(app));
    await app.init();
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  it('GET /health/live always returns 200 {"status":"ok"} — no dependency checks', async () => {
    const res = await request(app.getHttpServer()).get('/health/live');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('GET /health/ready returns 200 with database/redis "up" when both are reachable', async () => {
    const res = await request(app.getHttpServer()).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ready', database: 'up', redis: 'up' });
  });

  it('never exposes connection details in either response body', async () => {
    const [live, ready] = await Promise.all([
      request(app.getHttpServer()).get('/health/live'),
      request(app.getHttpServer()).get('/health/ready'),
    ]);
    const bodies = JSON.stringify([live.body, ready.body]);
    expect(bodies).not.toMatch(/postgresql:\/\//i);
    expect(bodies).not.toMatch(/redis:\/\//i);
    expect(bodies).not.toMatch(/password/i);
  });
});
