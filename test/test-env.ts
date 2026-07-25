import { config as loadDotenv } from 'dotenv';
import { join } from 'path';
import { assertTestDatabaseUrl } from './test-database.util';

/**
 * Jest `setupFiles` entry — runs inside EVERY worker, before the test
 * framework and before any module (including `@prisma/client`) is imported.
 *
 * Ordering is the whole point:
 *   1. `override: true` makes `.env.test` win over anything already loaded,
 *      so a stray `.env` in the environment cannot redirect a run at the
 *      development database.
 *   2. `@nestjs/config` only assigns keys that are NOT already present in
 *      `process.env`, so whatever is set here survives `ConfigModule`.
 *   3. `PrismaService` calls a bare `super()` and reads `process.env
 *      .DATABASE_URL` when it is constructed during Nest DI — long after
 *      this file has run.
 *
 * Then assert, so a misconfigured run fails immediately with a clear message
 * instead of quietly writing fixtures into real data.
 */
loadDotenv({ path: join(__dirname, '..', '.env.test'), override: true });

assertTestDatabaseUrl(process.env.DATABASE_URL, process.env.NODE_ENV);
