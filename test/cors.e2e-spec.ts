import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WsAdapter } from '@nestjs/platform-ws';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { parseAllowedOrigins } from '../src/config/cors-origins.util';

// Phase 3 — exercises app.enableCors(...) at the real HTTP layer. e2e specs
// in this repo build their Nest app directly (Test.createTestingModule +
// createNestApplication) rather than running main.ts's bootstrap(), so
// main.ts's CORS setup is replicated here exactly — same pattern
// auth.e2e-spec.ts already uses for cookie-parser/ValidationPipe.
//
// Target is GET /health/live: public, no auth, deterministic 200 regardless
// of Origin — CORS behavior itself never changes a request's status code,
// only whether the browser is allowed to read the response afterward via
// the Access-Control-Allow-* headers, so a fixed-200 endpoint isolates
// exactly that.
const TRUSTED_ORIGIN = 'http://localhost:5174'; // .env.test.example's CORS_ALLOWED_ORIGINS
const UNTRUSTED_ORIGIN = 'https://evil.example.com';

describe('CORS (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // AppModule includes SpeakingLiveGateway — app.init() over the full module graph needs an explicit WS adapter (plain 'ws', not the socket.io default) or it throws. See learning.service.spec.ts's own comment.
    app.useWebSocketAdapter(new WsAdapter(app));
    const config = app.get(ConfigService);
    const allowedOrigins = parseAllowedOrigins(
      config.get<string>('CORS_ALLOWED_ORIGINS'),
    );
    app.enableCors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin.toLowerCase())) {
          return callback(null, true);
        }
        return callback(null, false);
      },
      credentials: true,
      methods: 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      allowedHeaders: ['Content-Type', 'Authorization'],
    });
    await app.init();
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  it('echoes Access-Control-Allow-Origin + Allow-Credentials for a trusted Origin', async () => {
    const res = await request(app.getHttpServer())
      .get('/health/live')
      .set('Origin', TRUSTED_ORIGIN);

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(TRUSTED_ORIGIN);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('omits the CORS allow headers for an untrusted Origin (request still succeeds server-side — the browser is what blocks it)', async () => {
    const res = await request(app.getHttpServer())
      .get('/health/live')
      .set('Origin', UNTRUSTED_ORIGIN);

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('with no Origin header at all, succeeds with no CORS allow headers (not a cross-origin request)', async () => {
    const res = await request(app.getHttpServer()).get('/health/live');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
