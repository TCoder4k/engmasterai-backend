// Shared by the generic mapper and the validator so "what counts as a
// duplicate" / "what counts as an unmapped alias" is decided in one place.

export function normalizeDedupeKey(text: string): string {
  return text.trim().toLowerCase();
}

export function splitMultiValue(
  raw: string | undefined,
  separator: string,
): string[] {
  if (!raw) return [];
  return raw
    .split(separator)
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

export interface AliasResolution {
  value?: string;
  // true only when the raw cell was non-empty but no alias matched it — an
  // empty cell is not an error, it's simply "no value provided."
  unmapped: boolean;
}

export function resolveAlias(
  raw: string | undefined,
  aliases: Record<string, string> | undefined,
): AliasResolution {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return { unmapped: false };

  const resolved = aliases?.[trimmed];
  if (resolved) return { value: resolved, unmapped: false };

  return { unmapped: true };
}
