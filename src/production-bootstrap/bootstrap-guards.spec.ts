import {
  BootstrapGuardError,
  parseDatabaseIdentity,
  assertSourceIsDevDatabase,
  requireDestinationConnectionString,
  assertSourceAndDestinationDiffer,
  assertConfirmedDestinationName,
  assertProductionApplyAcknowledged,
  assertMigrationHistoryIsClean,
  assertMigrationNameSetsMatch,
} from './bootstrap-guards';

const DEV_URL = 'postgresql://user:pass@localhost:5432/engmasterai?schema=public';
const DEV_URL_LOOPBACK = 'postgresql://user:pass@127.0.0.1:5432/engmasterai?schema=public';
const TEST_URL = 'postgresql://user:pass@localhost:5432/engmasterai_test?schema=public';
const PROD_URL = 'postgresql://user:pass@localhost:55432/railway?schema=public';
// Same database NAME as dev, but on a remote host — must still be rejected.
const REMOTE_ENGMASTERAI_URL =
  'postgresql://user:pass@some-remote-host.example.com:5432/engmasterai?schema=public';

describe('parseDatabaseIdentity', () => {
  it('extracts host and database name, never credentials', () => {
    const identity = parseDatabaseIdentity(DEV_URL);
    expect(identity).toEqual({ host: 'localhost', database: 'engmasterai' });
  });

  it('throws on an unparseable connection string', () => {
    expect(() => parseDatabaseIdentity('not a url')).toThrow(BootstrapGuardError);
  });

  it('throws when the path has no database name', () => {
    expect(() => parseDatabaseIdentity('postgresql://user:pass@localhost:5432/')).toThrow(
      BootstrapGuardError,
    );
  });
});

describe('assertSourceIsDevDatabase', () => {
  it('accepts the real dev database on localhost', () => {
    expect(assertSourceIsDevDatabase(DEV_URL)).toEqual({
      host: 'localhost',
      database: 'engmasterai',
    });
  });

  it('accepts the real dev database on the 127.0.0.1 loopback', () => {
    expect(assertSourceIsDevDatabase(DEV_URL_LOOPBACK)).toEqual({
      host: '127.0.0.1',
      database: 'engmasterai',
    });
  });

  it('rejects a *_test database with a specific message', () => {
    expect(() => assertSourceIsDevDatabase(TEST_URL)).toThrow(/test database/i);
  });

  it('rejects any other database name', () => {
    expect(() => assertSourceIsDevDatabase(PROD_URL)).toThrow(BootstrapGuardError);
  });

  it('rejects a database named "engmasterai" on a non-local host', () => {
    expect(() => assertSourceIsDevDatabase(REMOTE_ENGMASTERAI_URL)).toThrow(/host/i);
  });
});

describe('requireDestinationConnectionString', () => {
  it('returns BOOTSTRAP_DEST_DATABASE_URL when set', () => {
    expect(
      requireDestinationConnectionString({ BOOTSTRAP_DEST_DATABASE_URL: PROD_URL } as NodeJS.ProcessEnv),
    ).toBe(PROD_URL);
  });

  it('throws when unset — never falls back to DATABASE_URL', () => {
    expect(() =>
      requireDestinationConnectionString({ DATABASE_URL: DEV_URL } as NodeJS.ProcessEnv),
    ).toThrow(/BOOTSTRAP_DEST_DATABASE_URL/);
  });

  it('throws when set to an empty string', () => {
    expect(() =>
      requireDestinationConnectionString({ BOOTSTRAP_DEST_DATABASE_URL: '  ' } as NodeJS.ProcessEnv),
    ).toThrow();
  });
});

describe('assertSourceAndDestinationDiffer', () => {
  it('passes when host+database differ', () => {
    expect(() =>
      assertSourceAndDestinationDiffer(
        { host: 'localhost', database: 'engmasterai' },
        { host: 'localhost', database: 'railway' },
      ),
    ).not.toThrow();
  });

  it('throws when source and destination resolve to the same identity', () => {
    expect(() =>
      assertSourceAndDestinationDiffer(
        { host: 'localhost', database: 'engmasterai' },
        { host: 'localhost', database: 'engmasterai' },
      ),
    ).toThrow(BootstrapGuardError);
  });
});

describe('assertConfirmedDestinationName', () => {
  it('passes when --confirm-db matches the real destination name', () => {
    expect(() => assertConfirmedDestinationName('railway', 'railway')).not.toThrow();
  });

  it('throws when --confirm-db is missing', () => {
    expect(() => assertConfirmedDestinationName(undefined, 'railway')).toThrow(
      /--confirm-db is required/,
    );
  });

  it('throws when --confirm-db does not match', () => {
    expect(() => assertConfirmedDestinationName('wrong-name', 'railway')).toThrow(
      BootstrapGuardError,
    );
  });
});

describe('assertProductionApplyAcknowledged', () => {
  it('passes when --confirm-production was given', () => {
    expect(() => assertProductionApplyAcknowledged(true)).not.toThrow();
  });

  it('throws when --confirm-production is missing, independent of --confirm-db', () => {
    expect(() => assertProductionApplyAcknowledged(false)).toThrow(/--confirm-production/);
  });
});

describe('assertMigrationHistoryIsClean', () => {
  it('passes when there are no failed or rolled-back migrations', () => {
    expect(() =>
      assertMigrationHistoryIsClean('source', { failedCount: 0, rolledBackCount: 0 }),
    ).not.toThrow();
  });

  it('throws and names the side when a rolled-back migration exists, even if the count would drop out of a "currently applied" fingerprint view', () => {
    expect(() =>
      assertMigrationHistoryIsClean('destination', { failedCount: 0, rolledBackCount: 1 }),
    ).toThrow(/destination.*rolled-back/is);
  });

  it('throws when a failed (never-finished) migration exists', () => {
    expect(() =>
      assertMigrationHistoryIsClean('source', { failedCount: 1, rolledBackCount: 0 }),
    ).toThrow(/source.*failed/is);
  });

  it('throws BootstrapGuardError', () => {
    expect(() =>
      assertMigrationHistoryIsClean('source', { failedCount: 1, rolledBackCount: 1 }),
    ).toThrow(BootstrapGuardError);
  });
});

describe('assertMigrationNameSetsMatch', () => {
  const base = [
    { migrationName: '20260101_init', checksum: 'abc' },
    { migrationName: '20260102_add_x', checksum: 'def' },
  ];

  it('passes when both sides have the identical migration name set', () => {
    expect(() => assertMigrationNameSetsMatch(base, [...base])).not.toThrow();
  });

  it('passes even when checksums differ for the same name — checksum equality is not this guard\'s job', () => {
    const differentChecksums = [
      { migrationName: '20260101_init', checksum: 'DIFFERENT' },
      { migrationName: '20260102_add_x', checksum: 'ALSO_DIFFERENT' },
    ];
    expect(() => assertMigrationNameSetsMatch(base, differentChecksums)).not.toThrow();
  });

  it('throws when the destination is missing a migration', () => {
    expect(() => assertMigrationNameSetsMatch(base, [base[0]])).toThrow(
      /Missing on destination.*20260102_add_x/s,
    );
  });

  it('throws when the source is missing a migration destination has', () => {
    const destinationOnly = [...base, { migrationName: '20260103_extra', checksum: 'ghi' }];
    expect(() => assertMigrationNameSetsMatch(base, destinationOnly)).toThrow(
      /Missing on source.*20260103_extra/s,
    );
  });
});
