import { config as loadDotenv } from 'dotenv';
import { execSync } from 'child_process';
import { join } from 'path';
import { assertTestDatabaseUrl } from './test-database.util';
import { sweepTestFixtures } from './test-fixture-sweep';

/**
 * Jest `globalSetup` — runs ONCE, in its own process, before any worker
 * starts. `setupFiles` (test/test-env.ts) re-does the env load per worker;
 * this file needs its own copy because global setup/teardown run outside
 * that per-worker lifecycle entirely.
 */
export default async function globalSetup(): Promise<void> {
  loadDotenv({ path: join(__dirname, '..', '.env.test'), override: true });
  assertTestDatabaseUrl(process.env.DATABASE_URL, process.env.NODE_ENV);

  // Applies pending migrations to the test database through the project's
  // existing Prisma workflow (`prisma migrate deploy`) — never
  // `migrate reset`, which would be a destructive operation this guard's
  // whole point is to avoid needing.
  execSync('npx prisma migrate deploy', {
    cwd: join(__dirname, '..'),
    stdio: 'inherit',
    env: process.env,
  });

  // Clears any fixture residue left by a previously interrupted run, so a
  // killed jest process can never accumulate orphaned rows across runs the
  // way it did in the development database before this guard existed.
  await sweepTestFixtures();
}
