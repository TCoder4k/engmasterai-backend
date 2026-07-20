import * as fs from 'fs';
import * as path from 'path';

const dirListingCache = new Map<string, string[]>();

function listDir(dir: string): string[] {
  const cached = dirListingCache.get(dir);
  if (cached) return cached;
  const listing = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  dirListingCache.set(dir, listing);
  return listing;
}

export interface MediaMatchResult {
  matchType: 'exact' | 'prefixGlob' | 'none';
  fileName?: string;
}

// Matches the real toeic600 media naming, confirmed by direct inspection of
// the dataset (see the approved plan §6/§8): exact slug.<ext> first, then
// the alphabetically-first file matching slug\d*.<ext> (handles the
// no-suffix / "2"-suffix variance found in the image folders). Anything
// messier than that (e.g. "penalty-n.mp3") is intentionally left unmatched
// — it falls back to the dataset's remote URL rather than chasing
// dataset-specific naming quirks with ever-more-specific regexes.
export function matchLocalFile(
  dir: string,
  slug: string,
  extensions: string[],
): MediaMatchResult {
  const files = listDir(dir);
  const extPattern = extensions.map((e) => e.replace('.', '')).join('|');

  for (const ext of extensions) {
    const exact = `${slug}${ext}`;
    if (files.some((f) => f.toLowerCase() === exact.toLowerCase())) {
      return { matchType: 'exact', fileName: exact };
    }
  }

  const escaped = slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const globRegex = new RegExp(`^${escaped}\\d*\\.(${extPattern})$`, 'i');
  const candidates = files.filter((f) => globRegex.test(f)).sort();
  if (candidates.length > 0) {
    return { matchType: 'prefixGlob', fileName: candidates[0] };
  }

  return { matchType: 'none' };
}

export function clearMediaMatcherCache(): void {
  dirListingCache.clear();
}

export function resolveMediaPath(dir: string, fileName: string): string {
  return path.join(dir, fileName);
}
