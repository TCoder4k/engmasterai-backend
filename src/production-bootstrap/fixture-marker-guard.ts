// Phase 7 requirement #4 — a runtime scan, not a point-in-time assumption.
// The 14 content models are structurally never queried by test fixtures
// (only User/progress tables ever get __test__ rows in normal operation),
// but nothing stops a Course or VocabLibrary row from picking up that marker
// tomorrow. This scans every source row actually fetched, every run.
import type { ContentRow } from './content-diff';

// Deliberately duplicated from test/test-database.util.ts's
// TEST_FIXTURE_PREFIX rather than imported: src/production-bootstrap is
// production tooling and must not depend on test/ — the whole point of that
// boundary (see docs/CLAUDE.md's test-database guard notes) is that test
// infrastructure never becomes a dependency of anything else.
export const FIXTURE_MARKER = '__test__';

const searchableValue = (value: unknown): string => {
  if (typeof value === 'string') return value;
  // JSON.stringify(undefined) returns undefined, not a string — every other
  // value (including null) stringifies to a real string.
  return JSON.stringify(value) ?? '';
};

// Checks every field, not a hand-picked subset — a JSON field (e.g.
// PlacementQuestion.correctAnswer) is stringified and scanned too, so a
// marker buried inside JSON content is still caught.
export const rowContainsFixtureMarker = (row: ContentRow): boolean =>
  Object.values(row).some((value) => searchableValue(value).includes(FIXTURE_MARKER));

export interface FixtureMarkerHit {
  readonly modelName: string;
  readonly id: string;
}

export const findFixtureMarkerHits = (
  modelName: string,
  rows: readonly ContentRow[],
): readonly FixtureMarkerHit[] =>
  rows.filter(rowContainsFixtureMarker).map((row) => ({ modelName, id: row.id }));

export class FixtureContaminationError extends Error {
  constructor(hits: readonly FixtureMarkerHit[]) {
    super(
      `Source content contains ${hits.length} row(s) with a "${FIXTURE_MARKER}" fixture marker — ` +
        `refusing to run (dry run or apply). Affected: ${hits
          .map((hit) => `${hit.modelName}:${hit.id}`)
          .join(', ')}`,
    );
    this.name = 'FixtureContaminationError';
  }
}

export const assertNoFixtureContamination = (hits: readonly FixtureMarkerHit[]): void => {
  if (hits.length > 0) {
    throw new FixtureContaminationError(hits);
  }
};
