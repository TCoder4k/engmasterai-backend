// Phase 7 — durable run manifest. Written BEFORE the first write to the
// destination, and re-flushed after every domain that successfully commits,
// so an interrupted run's rollback (delete exactly these ids, nothing else)
// never depends on memory that could have been lost.
//
// Deliberately stores only ids, never row content and never connection
// strings/credentials — see bootstrap-guards.ts's parseDatabaseIdentity for
// why only host+database names are ever handled by this tool at all.

import { mkdirSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { DomainName } from './content-domains';

export type DomainStatus = 'pending' | 'committed' | 'failed';

export interface DomainManifestEntry {
  status: DomainStatus;
  models: readonly string[];
  /** model name -> ids planned/committed for insert in this domain */
  plannedIds: Readonly<Record<string, readonly string[]>>;
  committedAt: string | null;
}

export interface RunManifest {
  runId: string;
  startedAt: string;
  sourceDatabase: string;
  destinationDatabase: string;
  domains: Record<DomainName, DomainManifestEntry>;
}

export const buildInitialManifest = (
  runId: string,
  sourceDatabase: string,
  destinationDatabase: string,
  plannedIdsByDomain: Record<DomainName, Record<string, readonly string[]>>,
): RunManifest => {
  const domains = {} as RunManifest['domains'];
  for (const domain of Object.keys(plannedIdsByDomain) as DomainName[]) {
    const plannedIds = plannedIdsByDomain[domain];
    domains[domain] = {
      status: 'pending',
      models: Object.keys(plannedIds),
      plannedIds,
      committedAt: null,
    };
  }
  return {
    runId,
    startedAt: new Date().toISOString(),
    sourceDatabase,
    destinationDatabase,
    domains,
  };
};

// Pure state transition — no I/O. The orchestrator persists the result.
export const withDomainStatus = (
  manifest: RunManifest,
  domain: DomainName,
  status: Extract<DomainStatus, 'committed' | 'failed'>,
): RunManifest => ({
  ...manifest,
  domains: {
    ...manifest.domains,
    [domain]: {
      ...manifest.domains[domain],
      status,
      committedAt:
        status === 'committed'
          ? new Date().toISOString()
          : manifest.domains[domain].committedAt,
    },
  },
});

const LOG_DIR = join(process.cwd(), 'bootstrap-logs');

export const manifestFilePath = (runId: string): string =>
  join(LOG_DIR, `${runId}.json`);

// Write-to-temp-then-rename: renameSync onto the same volume is atomic on
// both POSIX and NTFS, so a process killed mid-write can never leave a
// truncated/corrupt manifest at the real path — recovery only ever sees a
// fully-written file or the previous fully-written version.
export const persistManifest = (manifest: RunManifest): void => {
  mkdirSync(LOG_DIR, { recursive: true });
  const finalPath = manifestFilePath(manifest.runId);
  const tempPath = `${finalPath}.tmp`;
  writeFileSync(tempPath, JSON.stringify(manifest, null, 2), 'utf-8');
  renameSync(tempPath, finalPath);
};
