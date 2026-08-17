// Phase 7 — Production Content Bootstrap. Copies the approved, hardcoded
// content-model allowlist (see content-domains.ts) from the local dev
// database into a Railway production database reached through a private
// `railway connect --tunnel-only` tunnel — see the Phase 7 report for the
// full runbook. This file is deliberately thin: every piece of logic that
// can be unit tested without a live database lives in a sibling module
// (bootstrap-guards.ts, content-diff.ts, run-manifest.ts, cli-args.ts) and
// is tested there. This file only wires them together against real Prisma
// clients.
//
// Modes (mutually exclusive):
//   (no flags)        dry run — read-only diff report against both databases.
//   --verify-only      read-only deep verification against the destination
//                       alone (FK orphans, Placement checkpoint).
//   --apply --confirm-db <name> --confirm-production   the only mode that
//                       writes. Create-only: an id that already exists with
//                       DIFFERENT content hard-fails its whole domain — see
//                       content-diff.ts. Both --confirm-db and
//                       --confirm-production are required and checked
//                       independently — see bootstrap-guards.ts.
//
// Every run (dry run AND apply — not just apply) scans the source content it
// fetched for the repo's __test__ fixture marker and refuses to proceed if
// any is found — see fixture-marker-guard.ts.
//
// Run with:
//   npm run bootstrap:content:dry-run
//   npm run bootstrap:content:verify
//   BOOTSTRAP_DEST_DATABASE_URL=... npm run bootstrap:content:apply -- --confirm-db <name> --confirm-production

import 'dotenv/config';
import { randomUUID } from 'crypto';
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { join, resolve as resolvePath } from 'path';
import { PrismaClient, QuestionDifficulty } from '@prisma/client';
import {
  CONTENT_MODELS,
  DOMAIN_ORDER,
  modelsForDomain,
  type ContentModelDefinition,
  type DomainName,
} from './content-domains';
import { diffRows, destinationOnlyRows, type ContentRow, type RowDiffResult } from './content-diff';
import {
  assertConfirmedDestinationName,
  assertMigrationNameSetsMatch,
  assertMigrationHistoryIsClean,
  assertProductionApplyAcknowledged,
  assertSourceAndDestinationDiffer,
  assertSourceIsDevDatabase,
  parseDatabaseIdentity,
  requireDestinationConnectionString,
  type MigrationHealth,
  type MigrationRecord,
} from './bootstrap-guards';
import {
  sha256Hex,
  normalizeLineEndings,
  assertProductionMigrationMatchesCanonical,
  classifySourceMigrationChecksum,
} from './migration-checksum-guard';
import { buildInitialManifest, persistManifest, withDomainStatus } from './run-manifest';
import { parseCliArgs } from './cli-args';
import {
  assertNoFixtureContamination,
  findFixtureMarkerHits,
  type FixtureMarkerHit,
} from './fixture-marker-guard';
import { PLACEMENT_SECTIONS, DIFFICULTY_REQUIREMENTS } from '../placement/placement.constants';

// Narrow, explicit `any` boundary. Prisma's generated client is strongly
// typed per model, but this tool is intentionally generic across the 14
// hardcoded content models in CONTENT_MODELS — writing 14 near-identical
// typed blocks would be more error-prone than one narrow, well-commented
// cast used only here.
interface GenericDelegate {
  findMany: () => Promise<ContentRow[]>;
  create: (args: { data: ContentRow }) => Promise<ContentRow>;
}

const getDelegate = (client: PrismaClient, delegateName: string): GenericDelegate =>
  (client as unknown as Record<string, GenericDelegate>)[delegateName];

const currentDatabaseName = async (client: PrismaClient): Promise<string> => {
  const rows = await client.$queryRawUnsafe<Array<{ current_database: string }>>(
    'SELECT current_database()',
  );
  return rows[0].current_database;
};

// Counts failed (started but never finished) and rolled-back migrations
// regardless of whether they'd also be excluded from the fingerprint view
// below — this is the "does this history need investigation at all" check,
// run BEFORE any fingerprint comparison so a rolled-back migration can never
// just quietly vanish from the result.
const fetchMigrationHealth = async (client: PrismaClient): Promise<MigrationHealth> => {
  const rows = await client.$queryRawUnsafe<
    Array<{ failed_count: bigint; rolled_back_count: bigint }>
  >(
    'SELECT ' +
      'COUNT(*) FILTER (WHERE finished_at IS NULL) AS failed_count, ' +
      'COUNT(*) FILTER (WHERE rolled_back_at IS NOT NULL) AS rolled_back_count ' +
      'FROM "_prisma_migrations"',
  );
  return {
    failedCount: Number(rows[0].failed_count),
    rolledBackCount: Number(rows[0].rolled_back_count),
  };
};

const fetchMigrationRecords = async (client: PrismaClient): Promise<MigrationRecord[]> => {
  const rows = await client.$queryRawUnsafe<
    Array<{ migration_name: string; checksum: string }>
  >(
    // finished_at IS NOT NULL alone is not enough — a migration that was
    // applied and later marked rolled back (`prisma migrate resolve
    // --rolled-back`) still has finished_at set from its original attempt.
    // rolled_back_at IS NULL excludes it, so the fingerprint only reflects
    // migrations that are genuinely, currently applied on each side.
    'SELECT migration_name, checksum FROM "_prisma_migrations" ' +
      'WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ' +
      'ORDER BY migration_name ASC',
  );
  return rows.map((row) => ({ migrationName: row.migration_name, checksum: row.checksum }));
};

// "Canonical" = the migration.sql content at the currently checked-out Git
// commit (HEAD) — i.e. what a fresh clone/build (Railway's Linux build
// environment included) would actually check out. Read via `git show`
// rather than the working tree so this is immune to any local, uncommitted
// edit and to the working tree's own line-ending checkout behavior.
const CANONICAL_GIT_REF = 'HEAD';
const MIGRATIONS_DIR = join(process.cwd(), 'prisma', 'migrations');

const fetchCanonicalMigrationBytes = (migrationName: string): Buffer =>
  execFileSync('git', [
    'show',
    `${CANONICAL_GIT_REF}:prisma/migrations/${migrationName}/migration.sql`,
  ]);

const fetchWorkingTreeMigrationBytes = (migrationName: string): Buffer =>
  readFileSync(join(MIGRATIONS_DIR, migrationName, 'migration.sql'));

// Redacts both connection strings out of any text before it can ever be
// logged or rethrown — needed because a failed child-process invocation can
// otherwise embed its full argv (including --from-url/--to-url) in the
// thrown Error's own message.
const redactSecrets = (text: string, secrets: readonly string[]): string =>
  secrets.reduce((acc, secret) => (secret ? acc.split(secret).join('[REDACTED_URL]') : acc), text);

// Invoking the Prisma CLI's JS entry point directly via `node`, rather than
// shelling out to `npx`/`npx.cmd`, sidesteps a Windows-specific
// spawn(ENOENT)/spawn(EINVAL) failure when a non-shell child_process call
// targets a .cmd wrapper script.
const PRISMA_CLI_ENTRYPOINT = resolvePath(process.cwd(), 'node_modules/prisma/build/index.js');

// Rule 5 — actual schema parity is a required preflight, independent of the
// per-migration checksum verification above: two databases can have
// identical migration checksums and still (in theory) have drifted if a
// migration was hand-edited outside Prisma's tracking. `prisma migrate diff
// --exit-code` is Prisma's own read-only schema comparison — exit 0 means no
// difference, exit 2 means a non-empty diff, anything else is a genuine
// failure to complete the check (e.g. cannot connect).
const assertSchemaParity = (sourceUrl: string, destUrl: string): void => {
  try {
    execFileSync(
      process.execPath,
      [PRISMA_CLI_ENTRYPOINT, 'migrate', 'diff', '--from-url', sourceUrl, '--to-url', destUrl, '--exit-code'],
      { stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 },
    );
  } catch (error) {
    const status = (error as { status?: number | null }).status;
    if (status === 2) {
      throw new Error(
        'Schema parity check failed: `prisma migrate diff` reports a non-empty diff between source ' +
          'and destination. Refusing to bootstrap content against schemas that have not converged.',
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      'Schema parity check could not be completed (prisma migrate diff exited unexpectedly): ' +
        redactSecrets(message, [sourceUrl, destUrl]),
    );
  }
};

const fetchAllRows = async (
  client: PrismaClient,
  model: ContentModelDefinition,
): Promise<ContentRow[]> => getDelegate(client, model.delegate).findMany();

interface ModelDiff {
  readonly model: ContentModelDefinition;
  readonly diff: RowDiffResult;
  readonly sourceCount: number;
  readonly destinationCount: number;
}

interface DiffComputation {
  readonly diffs: readonly ModelDiff[];
  readonly fixtureHits: readonly FixtureMarkerHit[];
}

const computeAllDiffs = async (
  sourcePrisma: PrismaClient,
  destPrisma: PrismaClient,
): Promise<DiffComputation> => {
  const diffs: ModelDiff[] = [];
  const fixtureHits: FixtureMarkerHit[] = [];
  for (const model of CONTENT_MODELS) {
    const [sourceRows, destinationRows] = await Promise.all([
      fetchAllRows(sourcePrisma, model),
      fetchAllRows(destPrisma, model),
    ]);
    fixtureHits.push(...findFixtureMarkerHits(model.name, sourceRows));
    diffs.push({
      model,
      diff: diffRows(sourceRows, destinationRows),
      sourceCount: sourceRows.length,
      destinationCount: destinationRows.length,
    });
  }
  return { diffs, fixtureHits };
};

const printDryRunReport = (
  sourceDb: string,
  destDb: string,
  diffs: readonly ModelDiff[],
): void => {
  console.log('=== Production Content Bootstrap — DRY RUN ===');
  console.log(`Source database:      ${sourceDb}`);
  console.log(`Destination database: ${destDb}`);
  console.log('');
  console.log(
    'Model'.padEnd(24) +
      'Source'.padStart(8) +
      'Dest'.padStart(8) +
      'Insert'.padStart(8) +
      'InSync'.padStart(8) +
      'Conflict'.padStart(10),
  );
  for (const { model, diff, sourceCount, destinationCount } of diffs) {
    console.log(
      model.name.padEnd(24) +
        String(sourceCount).padStart(8) +
        String(destinationCount).padStart(8) +
        String(diff.toInsert.length).padStart(8) +
        String(diff.inSync.length).padStart(8) +
        String(diff.conflicts.length).padStart(10),
    );
  }
  const totalConflicts = diffs.reduce((sum, d) => sum + d.diff.conflicts.length, 0);
  console.log('');
  if (totalConflicts > 0) {
    console.log(
      `${totalConflicts} conflicting row(s) found — --apply would HARD FAIL the affected domain(s). No content is ever overwritten.`,
    );
  }
  console.log('*** DRY RUN ONLY — no row was written. Re-run with --apply to write. ***');
};

const runPlacementCheckpoint = async (destPrisma: PrismaClient): Promise<boolean> => {
  console.log('\n=== Placement Question Bank Checkpoint (destination) ===');
  let allSatisfied = true;
  for (const section of PLACEMENT_SECTIONS) {
    for (const difficulty of Object.keys(DIFFICULTY_REQUIREMENTS) as QuestionDifficulty[]) {
      const required = DIFFICULTY_REQUIREMENTS[difficulty];
      const available = await destPrisma.placementQuestion.count({
        where: { section, difficulty, isPublished: true },
      });
      const ok = available >= required;
      allSatisfied = allSatisfied && ok;
      console.log(
        `${section} ${difficulty}: required=${required} available=${available} ${ok ? 'OK' : 'INSUFFICIENT'}`,
      );
    }
  }
  console.log(`Placement checkpoint: ${allSatisfied ? 'PASS' : 'FAIL'}`);
  return allSatisfied;
};

const runVerification = async (
  sourcePrisma: PrismaClient,
  destPrisma: PrismaClient,
): Promise<void> => {
  console.log('\n=== Verification ===');
  const { diffs } = await computeAllDiffs(sourcePrisma, destPrisma);
  let missingAtDestination = 0;
  let conflicts = 0;
  for (const { model, diff, sourceCount, destinationCount } of diffs) {
    const sourceRows = await fetchAllRows(sourcePrisma, model);
    const destRows = await fetchAllRows(destPrisma, model);
    const onlyAtDest = destinationOnlyRows(sourceRows, destRows);
    missingAtDestination += diff.toInsert.length;
    conflicts += diff.conflicts.length;
    console.log(
      `${model.name}: source=${sourceCount} destination=${destinationCount} ` +
        `missingAtDestination=${diff.toInsert.length} conflicts=${diff.conflicts.length} destinationOnly=${onlyAtDest.length}`,
    );
  }
  console.log(
    `\nTotals: missingAtDestination=${missingAtDestination} conflicts=${conflicts} ` +
      `${missingAtDestination === 0 && conflicts === 0 ? '(fully converged)' : ''}`,
  );

  console.log('\n=== FK orphan checks (destination) ===');
  let orphanCount = 0;
  for (const model of CONTENT_MODELS) {
    for (const fk of model.foreignKeys) {
      const parentModel = CONTENT_MODELS.find((m) => m.name === fk.referencesModel);
      if (!parentModel) continue;
      const [childRows, parentRows] = await Promise.all([
        fetchAllRows(destPrisma, model),
        fetchAllRows(destPrisma, parentModel),
      ]);
      const parentIds = new Set(parentRows.map((row) => row.id));
      const orphans = childRows.filter((row) => !parentIds.has(row[fk.field] as string));
      if (orphans.length > 0) {
        orphanCount += orphans.length;
        console.warn(
          `ORPHAN: ${model.name}.${fk.field} has ${orphans.length} row(s) referencing a missing ${parentModel.name}`,
        );
      }
    }
  }
  console.log(orphanCount === 0 ? 'FK orphan checks: PASS (0 orphans)' : `FK orphan checks: FAIL (${orphanCount} orphans)`);

  await runPlacementCheckpoint(destPrisma);
};

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));

  const sourceUrl = process.env.DATABASE_URL;
  if (!sourceUrl) {
    throw new Error('DATABASE_URL is not set (bootstrap source).');
  }
  const declaredSourceIdentity = assertSourceIsDevDatabase(sourceUrl);

  const destUrl = requireDestinationConnectionString(process.env);
  const declaredDestIdentity = parseDatabaseIdentity(destUrl);
  assertSourceAndDestinationDiffer(declaredSourceIdentity, declaredDestIdentity);

  const sourcePrisma = new PrismaClient({ datasources: { db: { url: sourceUrl } } });
  const destPrisma = new PrismaClient({ datasources: { db: { url: destUrl } } });

  try {
    // Re-verify identity against the LIVE connection, not just the URL —
    // a pooler/proxy could rewrite the path without changing the real DB.
    const [liveSourceDb, liveDestDb] = await Promise.all([
      currentDatabaseName(sourcePrisma),
      currentDatabaseName(destPrisma),
    ]);
    if (liveSourceDb !== declaredSourceIdentity.database) {
      throw new Error(
        `Source connection string claims database "${declaredSourceIdentity.database}" but the live connection reports "${liveSourceDb}".`,
      );
    }

    const [sourceHealth, destHealth] = await Promise.all([
      fetchMigrationHealth(sourcePrisma),
      fetchMigrationHealth(destPrisma),
    ]);
    assertMigrationHistoryIsClean('source', sourceHealth);
    assertMigrationHistoryIsClean('destination', destHealth);

    const [sourceMigrations, destMigrations] = await Promise.all([
      fetchMigrationRecords(sourcePrisma),
      fetchMigrationRecords(destPrisma),
    ]);
    assertMigrationNameSetsMatch(sourceMigrations, destMigrations);

    console.log('\n=== Migration checksum verification (canonical Git vs recorded) ===');
    for (const destRecord of destMigrations) {
      const canonicalBytes = fetchCanonicalMigrationBytes(destRecord.migrationName);
      const canonicalChecksum = sha256Hex(canonicalBytes);
      // Production: zero tolerance, must match canonical exactly.
      assertProductionMigrationMatchesCanonical(destRecord.migrationName, destRecord.checksum, canonicalChecksum);

      // Local dev: allowed exactly one narrow, proven exception — see
      // migration-checksum-guard.ts. classifySourceMigrationChecksum throws
      // on any other kind of divergence.
      const sourceRecord = sourceMigrations.find(
        (record) => record.migrationName === destRecord.migrationName,
      )!;
      const workingTreeBytes = fetchWorkingTreeMigrationBytes(destRecord.migrationName);
      const classification = classifySourceMigrationChecksum(destRecord.migrationName, {
        recordedChecksum: sourceRecord.checksum,
        canonicalChecksum,
        canonicalNormalizedChecksum: sha256Hex(normalizeLineEndings(canonicalBytes)),
        workingTreeChecksum: sha256Hex(workingTreeBytes),
        workingTreeNormalizedChecksum: sha256Hex(normalizeLineEndings(workingTreeBytes)),
      });
      console.log(`  ${destRecord.migrationName}: production=CANONICAL source=${classification}`);
    }
    console.log(`Migration checksum verification: PASS (${destMigrations.length} migration(s))`);

    console.log('\n=== Schema parity check (prisma migrate diff) ===');
    assertSchemaParity(sourceUrl, destUrl);
    console.log('Schema parity check: PASS (no difference detected)');

    if (args.verifyOnly) {
      await runVerification(sourcePrisma, destPrisma);
      return;
    }

    const { diffs, fixtureHits } = await computeAllDiffs(sourcePrisma, destPrisma);
    // Applies to BOTH modes below, not just --apply — a contaminated dry
    // run report is exactly as unsafe to act on as a contaminated apply.
    assertNoFixtureContamination(fixtureHits);

    if (!args.apply) {
      printDryRunReport(liveSourceDb, liveDestDb, diffs);
      return;
    }

    assertConfirmedDestinationName(args.confirmDb, liveDestDb);
    assertProductionApplyAcknowledged(args.confirmProduction);

    const diffByModelName = new Map(diffs.map((d) => [d.model.name, d.diff]));
    const plannedIdsByDomain = {} as Record<DomainName, Record<string, readonly string[]>>;
    for (const domain of DOMAIN_ORDER) {
      const plannedIds: Record<string, readonly string[]> = {};
      for (const model of modelsForDomain(domain)) {
        plannedIds[model.name] = diffByModelName.get(model.name)!.toInsert.map((row) => row.id);
      }
      plannedIdsByDomain[domain] = plannedIds;
    }

    let manifest = buildInitialManifest(
      randomUUID(),
      liveSourceDb,
      liveDestDb,
      plannedIdsByDomain,
    );
    persistManifest(manifest);
    console.log(`Run manifest written before any write: bootstrap-logs/${manifest.runId}.json`);

    for (const domain of DOMAIN_ORDER) {
      const domainModels = modelsForDomain(domain);
      const domainConflicts = domainModels.flatMap(
        (model) => diffByModelName.get(model.name)!.conflicts,
      );
      if (domainConflicts.length > 0) {
        manifest = withDomainStatus(manifest, domain, 'failed');
        persistManifest(manifest);
        throw new Error(
          `Domain "${domain}" has ${domainConflicts.length} conflicting row(s) — refusing to write ` +
            `any part of this domain. Conflicting ids: ${domainConflicts.map((c) => c.id).join(', ')}`,
        );
      }

      const toInsertCount = domainModels.reduce(
        (sum, model) => sum + diffByModelName.get(model.name)!.toInsert.length,
        0,
      );
      if (toInsertCount === 0) {
        manifest = withDomainStatus(manifest, domain, 'committed');
        persistManifest(manifest);
        console.log(`Domain "${domain}": nothing to insert, already in sync.`);
        continue;
      }

      try {
        await destPrisma.$transaction(async (tx) => {
          for (const model of domainModels) {
            const rowsToInsert = diffByModelName.get(model.name)!.toInsert;
            for (const row of rowsToInsert) {
              await getDelegate(tx as unknown as PrismaClient, model.delegate).create({
                data: row,
              });
            }
          }
        });
        manifest = withDomainStatus(manifest, domain, 'committed');
        persistManifest(manifest);
        console.log(`Domain "${domain}": committed (${toInsertCount} row(s) inserted).`);
      } catch (error) {
        manifest = withDomainStatus(manifest, domain, 'failed');
        persistManifest(manifest);
        throw error;
      }
    }

    await runVerification(sourcePrisma, destPrisma);
  } finally {
    await sourcePrisma.$disconnect();
    await destPrisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
