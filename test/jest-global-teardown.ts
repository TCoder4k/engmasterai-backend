import { config as loadDotenv } from 'dotenv';
import { join } from 'path';
import { assertTestDatabaseUrl } from './test-database.util';
import { sweepTestFixtures } from './test-fixture-sweep';

/**
 * Jest `globalTeardown` — runs ONCE after every worker finishes. The normal
 * path (each suite's own `afterAll`) should already have cleaned up; this is
 * the backstop for whatever a suite missed or an aborted assertion skipped.
 */
export default async function globalTeardown(): Promise<void> {
  loadDotenv({ path: join(__dirname, '..', '.env.test'), override: true });
  assertTestDatabaseUrl(process.env.DATABASE_URL, process.env.NODE_ENV);

  await sweepTestFixtures();
}
