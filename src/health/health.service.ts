import { Injectable } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';

// Bounded on purpose: a hung Postgres/Redis call must never hold up the
// readiness check itself — that would turn "dependency is slow" into
// "healthcheck endpoint is also slow/hanging", defeating its own point.
const DEPENDENCY_CHECK_TIMEOUT_MS = 2000;

type DependencyStatus = 'up' | 'down';

export interface ReadinessResult {
  ready: boolean;
  database: DependencyStatus;
  redis: DependencyStatus;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('dependency check timed out')), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

/**
 * Backs GET /health/ready. Deliberately reports only "up"/"down" per
 * dependency — never the underlying error message, host, or connection
 * string, which could leak infrastructure detail to whatever is allowed to
 * reach this (unauthenticated) endpoint.
 *
 * A deployment-time readiness check (what a platform like Railway asks once
 * to decide whether to route traffic to a new release), not continuous
 * runtime monitoring — see health.controller.ts.
 */
@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  async checkReadiness(): Promise<ReadinessResult> {
    const [database, redis] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
    ]);
    return { ready: database === 'up' && redis === 'up', database, redis };
  }

  private async checkDatabase(): Promise<DependencyStatus> {
    try {
      await withTimeout(
        this.prisma.$queryRaw`SELECT 1`,
        DEPENDENCY_CHECK_TIMEOUT_MS,
      );
      return 'up';
    } catch {
      return 'down';
    }
  }

  private async checkRedis(): Promise<DependencyStatus> {
    try {
      await withTimeout(this.redis.ping(), DEPENDENCY_CHECK_TIMEOUT_MS);
      return 'up';
    } catch {
      return 'down';
    }
  }
}
