// Phase 7 — EOL-aware migration checksum guard.
//
// Prisma's `_prisma_migrations.checksum` is a SHA-256 of the exact bytes of
// migration.sql at the moment it was applied. On this project, `prisma
// migrate dev` was first run on Windows (`core.autocrlf=true`, no
// `.gitattributes` forcing LF for prisma/migrations at the time), so local
// dev's recorded checksum for one migration reflects a CRLF version of the
// file, while Railway's Linux build environment checked out the same Git
// blob as LF and recorded a different checksum for the identical SQL. That
// was diagnosed and proven for 20260119074311_init in the Phase 7 dry-run
// report — but this guard proves the same property generically, for every
// migration, every run, rather than trusting that one-time manual finding or
// special-casing a migration name.
//
// Production is held to a strict standard: its recorded checksum must match
// the canonical Git blob exactly, with zero tolerance (see
// assertProductionMigrationMatchesCanonical). Local dev is allowed exactly
// one narrow exception — a checksum that diverges from canonical ONLY by
// line endings, proven byte-for-byte after normalization — and nothing else
// (see classifySourceMigrationChecksum). Any other kind of divergence, on
// either side, is a hard failure.

import { createHash } from 'crypto';

export class MigrationChecksumGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationChecksumGuardError';
  }
}

export const sha256Hex = (bytes: Buffer): string =>
  createHash('sha256').update(bytes).digest('hex');

// CRLF -> LF only. Bytes are decoded as latin1 (a lossless 1:1 byte<->code
// unit mapping) solely so the \r\n literal can be matched and replaced —
// this never interprets or alters any other byte value, so it is safe to
// apply to a UTF-8 SQL file.
export const normalizeLineEndings = (bytes: Buffer): Buffer =>
  Buffer.from(bytes.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');

// Production is never granted the EOL-only exception available to local dev
// below — its applied migration history must trace back to source control
// exactly, or bootstrapping content against it is refused outright.
export const assertProductionMigrationMatchesCanonical = (
  migrationName: string,
  recordedChecksum: string,
  canonicalChecksum: string,
): void => {
  if (recordedChecksum !== canonicalChecksum) {
    throw new MigrationChecksumGuardError(
      `Production migration "${migrationName}": recorded checksum does not match the canonical Git ` +
        "blob for its migration.sql. Production's applied migration history does not correspond to " +
        'source control — refusing to bootstrap content until this is reconciled.',
    );
  }
};

export type SourceMigrationChecksumClassification = 'MATCH' | 'EOL_ONLY';

export interface SourceMigrationChecksumEvidence {
  readonly recordedChecksum: string;
  readonly canonicalChecksum: string;
  readonly canonicalNormalizedChecksum: string;
  readonly workingTreeChecksum: string;
  readonly workingTreeNormalizedChecksum: string;
}

// Implements the exact proof required before a local dev checksum mismatch
// may be classified as EOL_ONLY rather than failing outright:
//   1. the recorded checksum must match the CURRENT working-tree file
//      exactly — rules out a checksum that is simply stale or unrelated to
//      what's on disk today;
//   2. canonical and working-tree content, each independently normalized
//      CRLF->LF, must be byte-for-byte identical — rules out any real SQL
//      content difference (normalizing both sides, rather than assuming
//      canonical is already LF-only, keeps this proof self-contained);
//   3. only if both hold is it classified EOL_ONLY. Anything else throws.
// Never branches on migrationName — it is accepted only for error messages,
// so this proof is generic across every migration, not a lookup table keyed
// by name.
export const classifySourceMigrationChecksum = (
  migrationName: string,
  evidence: SourceMigrationChecksumEvidence,
): SourceMigrationChecksumClassification => {
  if (evidence.recordedChecksum === evidence.canonicalChecksum) {
    return 'MATCH';
  }
  if (evidence.recordedChecksum !== evidence.workingTreeChecksum) {
    throw new MigrationChecksumGuardError(
      `Local dev migration "${migrationName}": recorded checksum matches neither the canonical Git ` +
        'blob nor the current working-tree file — cannot prove this is a line-ending-only artifact. ' +
        'Refusing to proceed.',
    );
  }
  if (evidence.canonicalNormalizedChecksum !== evidence.workingTreeNormalizedChecksum) {
    throw new MigrationChecksumGuardError(
      `Local dev migration "${migrationName}": working-tree content differs from the canonical Git ` +
        'blob even after line-ending normalization — this is a real content change, not a ' +
        'line-ending artifact. Refusing to proceed.',
    );
  }
  return 'EOL_ONLY';
};
