import {
  FIXTURE_MARKER,
  rowContainsFixtureMarker,
  findFixtureMarkerHits,
  assertNoFixtureContamination,
  FixtureContaminationError,
} from './fixture-marker-guard';
import type { ContentRow } from './content-diff';

describe('FIXTURE_MARKER', () => {
  it('matches the repo-wide test fixture prefix convention', () => {
    // Mirrors test/test-database.util.ts's TEST_FIXTURE_PREFIX by design —
    // duplicated on purpose, see fixture-marker-guard.ts's header comment.
    expect(FIXTURE_MARKER).toBe('__test__');
  });
});

describe('rowContainsFixtureMarker', () => {
  it('is false for a clean row', () => {
    const row: ContentRow = { id: '1', title: 'Present Simple', description: 'A grammar course' };
    expect(rowContainsFixtureMarker(row)).toBe(false);
  });

  it('detects the marker in a plain string field', () => {
    const row: ContentRow = { id: '1', title: '__test__ Course' };
    expect(rowContainsFixtureMarker(row)).toBe(true);
  });

  it('detects the marker buried inside a JSON field', () => {
    const row: ContentRow = {
      id: '1',
      correctAnswer: { value: '__test__-answer' },
    };
    expect(rowContainsFixtureMarker(row)).toBe(true);
  });

  it('detects the marker inside a string array field', () => {
    const row: ContentRow = { id: '1', synonyms: ['ok', '__test__-synonym'] };
    expect(rowContainsFixtureMarker(row)).toBe(true);
  });

  it('is false when null/undefined fields are present', () => {
    const row: ContentRow = { id: '1', description: null, thumbnail: undefined };
    expect(rowContainsFixtureMarker(row)).toBe(false);
  });
});

describe('findFixtureMarkerHits', () => {
  it('returns only the contaminated rows, tagged with the model name', () => {
    const rows: ContentRow[] = [
      { id: 'clean-1', title: 'Real course' },
      { id: 'dirty-1', title: '__test__ course' },
    ];
    expect(findFixtureMarkerHits('Course', rows)).toEqual([{ modelName: 'Course', id: 'dirty-1' }]);
  });

  it('returns an empty array when nothing is contaminated', () => {
    expect(findFixtureMarkerHits('Course', [{ id: '1', title: 'Real' }])).toEqual([]);
  });
});

describe('assertNoFixtureContamination', () => {
  it('passes silently with no hits', () => {
    expect(() => assertNoFixtureContamination([])).not.toThrow();
  });

  it('throws FixtureContaminationError naming every affected model:id', () => {
    expect(() =>
      assertNoFixtureContamination([
        { modelName: 'Course', id: 'c1' },
        { modelName: 'VocabLibrary', id: 'v1' },
      ]),
    ).toThrow(FixtureContaminationError);

    try {
      assertNoFixtureContamination([{ modelName: 'Course', id: 'c1' }]);
      throw new Error('expected assertNoFixtureContamination to throw');
    } catch (error) {
      expect((error as Error).message).toContain('Course:c1');
    }
  });
});
