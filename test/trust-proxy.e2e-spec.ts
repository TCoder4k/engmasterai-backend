import { Controller, Get, Module, Req } from '@nestjs/common';
import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { Request } from 'express';
import { resolveTrustProxyValue } from '../src/config/trust-proxy.util';

// Phase 3 — isolated mechanics test for Express's `trust proxy` hop-count
// setting, NOT a claim about Railway's real proxy topology (which has not
// been observed yet — see README/"Known production TBDs"). A throwaway
// controller/module is used here instead of AppModule so this only
// exercises Express's own req.ip resolution, with nothing else (auth,
// Prisma, Redis) in the way.
//
// Express (via `proxy-addr`) walks the address chain from the socket
// OUTWARD: [remoteAddress (hop 0), X-Forwarded-For's LAST entry (hop 1),
// ..., X-Forwarded-For's FIRST entry (the furthest hop)]. `trust proxy: N`
// trusts hops 0..N-1 as proxies; req.ip becomes hop N — the first
// untrusted one. This means under-trusting (configuring fewer hops than
// actually exist) does not fail loudly: it silently returns an
// intermediate proxy's IP instead of the real client's. That is the
// specific pitfall test 3 below documents, so whoever sets TRUST_PROXY for
// real once Railway's topology is known reads this instead of re-deriving
// it from scratch.
@Controller()
class ProbeController {
  @Get('probe-ip')
  probe(@Req() req: Request) {
    return { ip: req.ip };
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

const buildApp = async (
  trustProxyRaw: string,
): Promise<INestApplication<App>> => {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [ProbeModule],
  }).compile();
  const app = moduleFixture.createNestApplication<NestExpressApplication>();
  app.set('trust proxy', resolveTrustProxyValue(trustProxyRaw));
  await app.init();
  return app;
};

describe('Express trust-proxy mechanics (e2e, isolated — not a Railway topology claim)', () => {
  it('trust proxy=false (current production default): X-Forwarded-For is ignored entirely, req.ip is always the raw socket address', async () => {
    const app = await buildApp('false');
    try {
      const res = await request(app.getHttpServer())
        .get('/probe-ip')
        .set('X-Forwarded-For', '9.9.9.9'); // must be ignored
      expect(res.body.ip).not.toBe('9.9.9.9');
    } finally {
      await app.close();
    }
  });

  it('trust proxy=1 with exactly one X-Forwarded-For entry: req.ip resolves to that entry (well-defined single-hop case)', async () => {
    const app = await buildApp('1');
    try {
      const res = await request(app.getHttpServer())
        .get('/probe-ip')
        .set('X-Forwarded-For', '9.9.9.9');
      expect(res.body.ip).toBe('9.9.9.9');
    } finally {
      await app.close();
    }
  });

  it('trust proxy=1 with TWO X-Forwarded-For entries: req.ip resolves to the intermediate proxy, NOT the original client — the under-trust pitfall', async () => {
    const app = await buildApp('1');
    try {
      // Left = original client, right = the one hop closest to us.
      const res = await request(app.getHttpServer())
        .get('/probe-ip')
        .set('X-Forwarded-For', '1.2.3.4, 5.5.5.5');
      expect(res.body.ip).toBe('5.5.5.5');
      expect(res.body.ip).not.toBe('1.2.3.4');
    } finally {
      await app.close();
    }
  });
});
