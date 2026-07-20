import { DatasetConfig } from '../types/dataset-config';

// Shared by the analyzer (media hit-rate stats need the same per-row deck
// folder a real import would use) and the generic mapper, so "which deck
// does this row belong to" is decided in exactly one place.
export function getDeckKey(row: Record<string, string>, deckFrom: DatasetConfig['deckFrom']): string {
  if ('fixed' in deckFrom) return deckFrom.fixed;
  return (row[deckFrom.column] ?? '').trim();
}
