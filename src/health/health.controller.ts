import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { HealthService } from './health.service';

/**
 * Public, unauthenticated, unrated-limited on purpose — a deploy platform's
 * prober has no access token and no browser Origin, and must be able to
 * call this before anything else about the release is trusted.
 *
 * /health/live: process is up and serving HTTP. No dependency checks — a
 * healthy process with a down Postgres/Redis must still report live (it
 * legitimately IS live; readiness is a separate question, see /ready).
 *
 * /health/ready: dependency-aware. Redis is fail-closed across most of this
 * app's auth paths (see docs/memory.md), so a liveness-only check could
 * report "healthy" while login/refresh/most protected routes are actually
 * down. This is what a deploy platform's readiness/healthcheck path should
 * point at — see health.service.ts for what it does and does not check,
 * and note this is a deployment-time gate, not continuous runtime
 * monitoring: a dependency that goes down AFTER a release has already
 * passed this check will not be caught by it again on its own.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready() {
    const result = await this.health.checkReadiness();
    if (!result.ready) {
      throw new ServiceUnavailableException({
        status: 'not_ready',
        database: result.database,
        redis: result.redis,
      });
    }
    return {
      status: 'ready' as const,
      database: result.database,
      redis: result.redis,
    };
  }
}
