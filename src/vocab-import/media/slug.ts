import { SlugStrategy } from '../types/dataset-config';

// Shared by the analyzer (media hit-rate stats) and the resolver (actual
// file lookup) so the two never drift on what "matches" means.
export function slugify(text: string, strategy: SlugStrategy = 'none'): string {
  const trimmed = text.trim();
  if (strategy === 'underscoreSpaces') {
    return trimmed.replace(/\s+/g, '_');
  }
  return trimmed;
}
