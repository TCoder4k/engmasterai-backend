import { Test, TestingModule } from '@nestjs/testing';
import { WsAdapter } from '@nestjs/platform-ws';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

// No AppController/root route exists in this app (every route lives under a
// feature module — auth, course, listening, etc.). This suite exists purely
// as an application-bootstrap smoke test: it proves the full Nest DI graph
// compiles and the HTTP adapter actually serves requests end-to-end, not
// that any specific route works. TODO: once a /health endpoint ships,
// replace the assertion below with a real health-check request.
describe('App bootstrap (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // AppModule includes SpeakingLiveGateway — app.init() over the full module graph needs an explicit WS adapter (plain 'ws', not the socket.io default) or it throws. See learning.service.spec.ts's own comment.
    app.useWebSocketAdapter(new WsAdapter(app));
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('boots and serves HTTP (unmatched route correctly 404s)', () => {
    return request(app.getHttpServer()).get('/').expect(404);
  });
});
