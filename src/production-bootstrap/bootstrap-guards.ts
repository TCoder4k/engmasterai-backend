// Phase 7 — Production Data Bootstrap safety guards. Every function here is
// pure (string/array in, throw-or-return out) so it can be unit tested
// without a live database connection. The orchestrator script is the only
// caller that owns real Prisma clients.

const DEV_DATABASE_NAME = 'engmasterai';
// The real dev setup (docker-compose.yml + .env) is always localhost — a
// database literally named "engmasterai" on some OTHER host is not this
// project's dev database, and must not be treated as one.
const DEV_DATABASE_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1']);

export class BootstrapGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BootstrapGuardError';
  }
}

export interface DatabaseIdentity {
  readonly host: string;
  readonly database: string;
}

// Deliberately returns only host + database name — never credentials. This
// is the ONLY shape of a connection string this module (or its callers)
// should ever log or print.
export const parseDatabaseIdentity = (connectionString: string): DatabaseIdentity => {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new BootstrapGuardError('Could not parse a database connection string.');
  }
  const database = url.pathname.replace(/^\//, '');
  if (!database) {
    throw new BootstrapGuardError('Connection string has no database name in its path.');
  }
  return { host: url.hostname, database };
};

export const assertSourceIsDevDatabase = (
  sourceConnectionString: string,
): DatabaseIdentity => {
  const identity = parseDatabaseIdentity(sourceConnectionString);
  if (identity.database.endsWith('_test')) {
    throw new BootstrapGuardError(
      `Bootstrap source resolves to "${identity.database}", which looks like a test database. ` +
        `Refusing to run — the bootstrap source must be the real "${DEV_DATABASE_NAME}" development database.`,
    );
  }
  if (identity.database !== DEV_DATABASE_NAME) {
    throw new BootstrapGuardError(
      `Bootstrap source resolves to "${identity.database}", not "${DEV_DATABASE_NAME}". ` +
        'Refusing to run against an unexpected source database.',
    );
  }
  if (!DEV_DATABASE_HOSTS.has(identity.host)) {
    throw new BootstrapGuardError(
      `Bootstrap source resolves to host "${identity.host}". A database named "${DEV_DATABASE_NAME}" ` +
        'on a non-local host is not this project\'s dev database — refusing to run. ' +
        `Expected one of: ${[...DEV_DATABASE_HOSTS].join(', ')}.`,
    );
  }
  return identity;
};

// The destination is NEVER inferred from DATABASE_URL — that variable is
// (and must stay) the bootstrap SOURCE everywhere else in this codebase.
export const requireDestinationConnectionString = (
  env: NodeJS.ProcessEnv,
): string => {
  const value = env.BOOTSTRAP_DEST_DATABASE_URL;
  if (!value || value.trim().length === 0) {
    throw new BootstrapGuardError(
      'BOOTSTRAP_DEST_DATABASE_URL is not set. The bootstrap destination is never inferred from DATABASE_URL.',
    );
  }
  return value;
};

export const assertSourceAndDestinationDiffer = (
  source: DatabaseIdentity,
  destination: DatabaseIdentity,
): void => {
  if (source.host === destination.host && source.database === destination.database) {
    throw new BootstrapGuardError(
      'Source and destination resolve to the same host + database. ' +
        'Refusing to run a no-op/self-copy bootstrap.',
    );
  }
};

// The explicit human-in-the-loop confirmation required before --apply is
// allowed to write anything. Compared against the destination's REAL
// current_database() (queried live), not the URL's path, so a misleading
// connection string (e.g. a pooler that rewrites the path) cannot slip past.
export const assertConfirmedDestinationName = (
  confirmDb: string | undefined,
  actualDestinationDatabase: string,
): void => {
  if (!confirmDb) {
    throw new BootstrapGuardError(
      '--confirm-db is required with --apply. Pass --confirm-db <destination-database-name>, ' +
        'matching the destination reported by the dry run.',
    );
  }
  if (confirmDb !== actualDestinationDatabase) {
    throw new BootstrapGuardError(
      `--confirm-db "${confirmDb}" does not match the destination database's real name ` +
        `"${actualDestinationDatabase}". Refusing to write.`,
    );
  }
};

// Independent of assertConfirmedDestinationName above — --confirm-db proves
// the operator saw the right database NAME, this proves they meant to run a
// write against production at all. Required together, checked separately,
// so a future caller cannot satisfy the "production" acknowledgement by
// accident while only intending to pass --confirm-db.
export const assertProductionApplyAcknowledged = (confirmProduction: boolean): void => {
  if (!confirmProduction) {
    throw new BootstrapGuardError(
      '--confirm-production is required with --apply — a literal, value-free acknowledgement ' +
        'that this run writes to production, independent of --confirm-db.',
    );
  }
};

export interface MigrationHealth {
  readonly failedCount: number;
  readonly rolledBackCount: number;
}

// A separate, earlier check from assertMigrationFingerprintsMatch below.
// Filtering the fingerprint query to "currently applied" migrations
// (finished_at IS NOT NULL AND rolled_back_at IS NULL) is correct for
// COMPARING schemas, but it also means a migration that was applied and
// later rolled back simply disappears from that view — two databases could
// report a matching fingerprint even though one of them has an unresolved
// rollback in its history. That is exactly the situation this guard exists
// to catch and abort on, before any fingerprint comparison happens: it must
// never be silently invisible.
export const assertMigrationHistoryIsClean = (
  label: 'source' | 'destination',
  health: MigrationHealth,
): void => {
  if (health.failedCount > 0 || health.rolledBackCount > 0) {
    throw new BootstrapGuardError(
      `The ${label} database's migration history is not clean: ${health.failedCount} failed ` +
        `and ${health.rolledBackCount} rolled-back migration(s) found in _prisma_migrations. ` +
        'Refusing to bootstrap against a database with an unresolved migration history — ' +
        'investigate and resolve (or roll forward) before retrying.',
    );
  }
};

export interface MigrationRecord {
  readonly migrationName: string;
  readonly checksum: string;
}

// The migration SET guard: bootstrap must refuse to run if source and
// destination have not applied the same named migrations. This checks
// membership only — NOT checksum equality between source and destination.
// Checksum equality is deliberately not required here because a legitimate,
// provable line-ending-only difference between environments can make
// source's and destination's checksums differ for the exact same SQL (see
// migration-checksum-guard.ts). Each migration's checksum is instead
// verified independently against the canonical Git blob by the caller,
// using classifySourceMigrationChecksum/assertProductionMigrationMatchesCanonical.
export const assertMigrationNameSetsMatch = (
  source: readonly MigrationRecord[],
  destination: readonly MigrationRecord[],
): void => {
  const destinationNames = new Set(destination.map((record) => record.migrationName));
  const sourceNames = new Set(source.map((record) => record.migrationName));
  const missingOnDestination = source
    .filter((record) => !destinationNames.has(record.migrationName))
    .map((record) => record.migrationName);
  const missingOnSource = destination
    .filter((record) => !sourceNames.has(record.migrationName))
    .map((record) => record.migrationName);

  if (missingOnDestination.length === 0 && missingOnSource.length === 0) {
    return;
  }

  throw new BootstrapGuardError(
    'Migration name sets differ between source and destination — refusing to bootstrap content ' +
      `against a schema that has not converged. Missing on destination: [${missingOnDestination.join(', ') || 'none'}]. ` +
      `Missing on source: [${missingOnSource.join(', ') || 'none'}].`,
  );
};
