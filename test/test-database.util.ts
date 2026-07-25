import { randomUUID } from 'crypto';

/**
 * Test-database safety guard.
 *
 * Sprint 04D. Both learning suites create `isPublished: true` libraries and
 * decks directly through Prisma, and for a while there was no test database
 * at all — every run wrote into the development database. When a teardown
 * aborted (a failed assertion, an FK violation, an interrupted jest process)
 * the published rows survived and showed up in the real student library list.
 * Five orphaned "Progress Test Library" rows had accumulated before anyone
 * noticed, because nothing asserted the student endpoints stayed clean.
 *
 * The structural fix is a dedicated database plus this guard, not more
 * careful cleanup: cleanup can always be skipped, but a suite that cannot
 * reach the development database cannot corrupt it in the first place.
 */

/** The development database. Never a legal test target. */
const DEVELOPMENT_DATABASE_NAME = 'engmasterai';

/**
 * Every fixture row created by a test is named through `testFixtureName()` so
 * the global teardown can sweep leftovers by prefix. That sweep is what makes
 * an interrupted run survivable — per-suite `afterAll` hooks never run when
 * the process is killed.
 */
export const TEST_FIXTURE_PREFIX = '__test__';

/**
 * Builds a prefixed, collision-proof fixture name. The random suffix keeps
 * parallel jest workers from colliding on names like `Progress Deck A`, which
 * used to be a fixed literal and produced duplicate rows across runs.
 */
export const testFixtureName = (base: string): string =>
  `${TEST_FIXTURE_PREFIX} ${base} ${randomUUID()}`;

/** Extracts the database name from a postgres connection URL. */
const databaseNameFrom = (databaseUrl: string): string => {
  // `new URL()` handles credentials/query strings for us; `pathname` is
  // `/<database>`. Deliberately parsed rather than regex-matched so a URL
  // with a password containing `/` can't confuse the check.
  const { pathname } = new URL(databaseUrl);
  return pathname.replace(/^\//, '');
};

/**
 * Throws unless it is safe to point a test run at `databaseUrl`.
 *
 * Error messages name the database only — never the full URL, which carries
 * credentials and would end up in CI logs.
 */
export function assertTestDatabaseUrl(
  databaseUrl: string | undefined,
  nodeEnv: string | undefined,
): void {
  if (!databaseUrl) {
    throw new Error(
      'Refusing to run tests: DATABASE_URL is not set. Copy .env.test.example to .env.test.',
    );
  }

  if (nodeEnv !== 'test') {
    throw new Error(
      `Refusing to run tests: NODE_ENV must be "test", received "${nodeEnv ?? 'undefined'}". ` +
        'Tests load .env.test — see .env.test.example.',
    );
  }

  let databaseName: string;
  try {
    databaseName = databaseNameFrom(databaseUrl);
  } catch {
    throw new Error(
      'Refusing to run tests: DATABASE_URL is not a parseable connection URL.',
    );
  }

  if (!databaseName) {
    throw new Error(
      'Refusing to run tests: DATABASE_URL does not name a database.',
    );
  }

  // Checked explicitly rather than relying on the `_test` suffix rule alone,
  // so the failure message names the actual mistake being made.
  if (databaseName === DEVELOPMENT_DATABASE_NAME) {
    throw new Error(
      `Refusing to run tests against the development database "${databaseName}". ` +
        'Tests create published libraries and decks; running them here would make ' +
        'fixture content visible to real users. Use a dedicated test database.',
    );
  }

  if (!databaseName.endsWith('_test')) {
    throw new Error(
      `Refusing to run tests against database "${databaseName}": a test database ` +
        'name must end in "_test" (e.g. "engmasterai_test").',
    );
  }
}
