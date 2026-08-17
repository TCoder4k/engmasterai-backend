import {
  MigrationChecksumGuardError,
  sha256Hex,
  normalizeLineEndings,
  assertProductionMigrationMatchesCanonical,
  classifySourceMigrationChecksum,
  type SourceMigrationChecksumEvidence,
} from './migration-checksum-guard';

const canonicalLf = Buffer.from('CREATE TABLE "foo" (\n  "id" TEXT NOT NULL\n);\n', 'utf-8');
const canonicalChecksum = sha256Hex(canonicalLf);
const canonicalNormalizedChecksum = sha256Hex(normalizeLineEndings(canonicalLf));

const crlfEquivalent = Buffer.from(
  canonicalLf.toString('latin1').replace(/\n/g, '\r\n'),
  'latin1',
);
const crlfChecksum = sha256Hex(crlfEquivalent);
const crlfNormalizedChecksum = sha256Hex(normalizeLineEndings(crlfEquivalent));

const differentLogicLf = Buffer.from(
  'CREATE TABLE "foo" (\n  "id" TEXT NOT NULL,\n  "extra" TEXT\n);\n',
  'utf-8',
);
const differentLogicChecksum = sha256Hex(differentLogicLf);
const differentLogicNormalizedChecksum = sha256Hex(normalizeLineEndings(differentLogicLf));

describe('normalizeLineEndings', () => {
  it('converts CRLF to LF and leaves the rest of the bytes untouched', () => {
    expect(normalizeLineEndings(crlfEquivalent)).toEqual(canonicalLf);
  });

  it('is a no-op on content that already has no CRLF', () => {
    expect(normalizeLineEndings(canonicalLf)).toEqual(canonicalLf);
  });
});

describe('assertProductionMigrationMatchesCanonical', () => {
  it('passes when the recorded checksum equals the canonical checksum', () => {
    expect(() =>
      assertProductionMigrationMatchesCanonical('20260101_init', canonicalChecksum, canonicalChecksum),
    ).not.toThrow();
  });

  it('fails when the recorded checksum does not equal the canonical checksum — no EOL leniency for production', () => {
    expect(() =>
      assertProductionMigrationMatchesCanonical('20260101_init', crlfChecksum, canonicalChecksum),
    ).toThrow(MigrationChecksumGuardError);
  });

  it('names the migration in the failure message', () => {
    expect(() =>
      assertProductionMigrationMatchesCanonical('20260101_init', 'WRONG', canonicalChecksum),
    ).toThrow(/20260101_init/);
  });
});

describe('classifySourceMigrationChecksum', () => {
  const evidenceFor = (recordedChecksum: string): SourceMigrationChecksumEvidence => ({
    recordedChecksum,
    canonicalChecksum,
    canonicalNormalizedChecksum,
    workingTreeChecksum: crlfChecksum,
    workingTreeNormalizedChecksum: crlfNormalizedChecksum,
  });

  it('MATCH: local checksum equals canonical directly', () => {
    expect(classifySourceMigrationChecksum('20260101_init', evidenceFor(canonicalChecksum))).toBe(
      'MATCH',
    );
  });

  it('EOL_ONLY: local checksum equals the CRLF working-tree checksum, and normalized content equals canonical', () => {
    expect(classifySourceMigrationChecksum('20260101_init', evidenceFor(crlfChecksum))).toBe(
      'EOL_ONLY',
    );
  });

  it('fails when the local checksum matches neither canonical nor the current working tree', () => {
    expect(() =>
      classifySourceMigrationChecksum('20260101_init', evidenceFor('SOME_STALE_UNRELATED_CHECKSUM')),
    ).toThrow(/matches neither the canonical Git blob nor the current working-tree file/);
  });

  it('fails when working-tree content has genuinely different SQL logic, even though the recorded checksum matches the working tree exactly', () => {
    const evidence: SourceMigrationChecksumEvidence = {
      recordedChecksum: differentLogicChecksum,
      canonicalChecksum,
      canonicalNormalizedChecksum,
      workingTreeChecksum: differentLogicChecksum,
      workingTreeNormalizedChecksum: differentLogicNormalizedChecksum,
    };
    expect(() => classifySourceMigrationChecksum('20260101_init', evidence)).toThrow(
      /real content change, not a line-ending artifact/,
    );
  });

  it('never special-cases a migration name — the same evidence shape yields the same verdict regardless of name', () => {
    expect(classifySourceMigrationChecksum('some_other_migration_name', evidenceFor(crlfChecksum))).toBe(
      'EOL_ONLY',
    );
  });

  it('throws MigrationChecksumGuardError on failure', () => {
    expect(() =>
      classifySourceMigrationChecksum('20260101_init', evidenceFor('UNRELATED')),
    ).toThrow(MigrationChecksumGuardError);
  });
});
