import { diffRows, rowsAreEqual, destinationOnlyRows, type ContentRow } from './content-diff';

const row = (id: string, overrides: Record<string, unknown> = {}): ContentRow => ({
  id,
  title: 'Example',
  isPublished: true,
  ...overrides,
});

describe('rowsAreEqual', () => {
  it('is true for structurally identical rows regardless of key order', () => {
    const a: ContentRow = { id: '1', title: 'A', isPublished: true };
    const b: ContentRow = { isPublished: true, id: '1', title: 'A' };
    expect(rowsAreEqual(a, b)).toBe(true);
  });

  it('is false when any field differs', () => {
    expect(rowsAreEqual(row('1'), row('1', { title: 'Different' }))).toBe(false);
  });

  it('treats equal Date instants as equal', () => {
    const a = row('1', { createdAt: new Date('2026-01-01T00:00:00.000Z') });
    const b = row('1', { createdAt: new Date('2026-01-01T00:00:00.000Z') });
    expect(rowsAreEqual(a, b)).toBe(true);
  });
});

describe('diffRows', () => {
  it('plans an insert for a source row missing at the destination', () => {
    const result = diffRows([row('1')], []);
    expect(result.toInsert.map((r) => r.id)).toEqual(['1']);
    expect(result.inSync).toHaveLength(0);
    expect(result.conflicts).toHaveLength(0);
  });

  it('reports a row as in-sync when source and destination are identical', () => {
    const result = diffRows([row('1')], [row('1')]);
    expect(result.toInsert).toHaveLength(0);
    expect(result.inSync.map((r) => r.id)).toEqual(['1']);
    expect(result.conflicts).toHaveLength(0);
  });

  it('reports a conflict — never a silent update — when the same id differs', () => {
    const result = diffRows([row('1', { title: 'New' })], [row('1', { title: 'Old' })]);
    expect(result.toInsert).toHaveLength(0);
    expect(result.inSync).toHaveLength(0);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].id).toBe('1');
  });

  it('handles a mix of insert/in-sync/conflict independently per row', () => {
    const source = [row('1'), row('2'), row('3', { title: 'New' })];
    const destination = [row('2'), row('3', { title: 'Old' })];
    const result = diffRows(source, destination);
    expect(result.toInsert.map((r) => r.id)).toEqual(['1']);
    expect(result.inSync.map((r) => r.id)).toEqual(['2']);
    expect(result.conflicts.map((c) => c.id)).toEqual(['3']);
  });
});

describe('destinationOnlyRows', () => {
  it('returns rows present at destination but absent from source', () => {
    const result = destinationOnlyRows([row('1')], [row('1'), row('2')]);
    expect(result.map((r) => r.id)).toEqual(['2']);
  });

  it('returns an empty array when destination has nothing extra', () => {
    expect(destinationOnlyRows([row('1')], [row('1')])).toHaveLength(0);
  });
});
