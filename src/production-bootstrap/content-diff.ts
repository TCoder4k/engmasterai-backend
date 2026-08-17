// Pure, DB-free diff logic for the create-only bootstrap strategy (Phase 7
// requirement #1): a source row with an id missing at the destination is
// planned for insert; a source row whose destination counterpart is
// byte-for-byte identical is left alone; a source row whose destination
// counterpart DIFFERS is a conflict — the caller must hard-fail the whole
// domain rather than overwrite it. There is no "update" path here at all.

export interface ContentRow {
  readonly id: string;
  readonly [field: string]: unknown;
}

export interface ContentConflict {
  readonly id: string;
  readonly sourceRow: ContentRow;
  readonly destinationRow: ContentRow;
}

export interface RowDiffResult {
  readonly toInsert: readonly ContentRow[];
  readonly inSync: readonly ContentRow[];
  readonly conflicts: readonly ContentConflict[];
}

// Deterministic string form of a row regardless of key insertion order, so
// two structurally-identical objects always compare equal. Date fields
// serialize to their ISO string via JSON.stringify, which is exactly the
// comparison we want (same instant -> same string).
const canonicalize = (row: ContentRow): string =>
  Object.keys(row)
    .sort()
    .map((key) => `${key}:${JSON.stringify(row[key])}`)
    .join('|');

export const rowsAreEqual = (a: ContentRow, b: ContentRow): boolean =>
  canonicalize(a) === canonicalize(b);

export const diffRows = (
  sourceRows: readonly ContentRow[],
  destinationRows: readonly ContentRow[],
): RowDiffResult => {
  const destinationById = new Map(
    destinationRows.map((row) => [row.id, row] as const),
  );

  const toInsert: ContentRow[] = [];
  const inSync: ContentRow[] = [];
  const conflicts: ContentConflict[] = [];

  for (const sourceRow of sourceRows) {
    const destinationRow = destinationById.get(sourceRow.id);
    if (!destinationRow) {
      toInsert.push(sourceRow);
    } else if (rowsAreEqual(sourceRow, destinationRow)) {
      inSync.push(sourceRow);
    } else {
      conflicts.push({ id: sourceRow.id, sourceRow, destinationRow });
    }
  }

  return { toInsert, inSync, conflicts };
};

/** Rows that exist at the destination but not in the source — informational
 * only (e.g. content an admin added directly in production); never acted on. */
export const destinationOnlyRows = (
  sourceRows: readonly ContentRow[],
  destinationRows: readonly ContentRow[],
): readonly ContentRow[] => {
  const sourceIds = new Set(sourceRows.map((row) => row.id));
  return destinationRows.filter((row) => !sourceIds.has(row.id));
};
