// Parses/validates CORS_ALLOWED_ORIGINS (Sprint 01C). Used by BOTH the
// startup Joi schema (env.validation.ts) and main.ts's actual CORS origin
// callback, so there is exactly one implementation of "what counts as a
// valid allowed origin" — never two parsers that could drift apart.
//
// Uses the platform's own URL parser rather than a hand-written regex
// (same principle as client-ip.util.ts leaning on Express's `req.ip`):
// fewer edge cases to get wrong than reimplementing URL validation.
export function parseAllowedOrigins(raw: string | undefined): string[] {
  if (!raw || raw.trim().length === 0) return [];

  return raw.split(',').map((entry) => normalizeOrigin(entry));
}

function normalizeOrigin(entry: string): string {
  const trimmed = entry.trim();

  if (trimmed.length === 0) {
    throw new Error('CORS_ALLOWED_ORIGINS contains an empty entry');
  }

  // A bare wildcard is never a valid URL, so `new URL('*')` already throws —
  // this explicit check exists only to give a clearer error message for the
  // single most likely misconfiguration this validation exists to prevent.
  if (trimmed === '*') {
    throw new Error(
      'CORS_ALLOWED_ORIGINS must not contain a wildcard origin ("*") — credentials are always enabled, and a wildcard origin with credentials is unsafe',
    );
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(
      `CORS_ALLOWED_ORIGINS entry is not a valid absolute URL: "${trimmed}"`,
    );
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(
      `CORS_ALLOWED_ORIGINS entry must use http:// or https://: "${trimmed}"`,
    );
  }

  if (url.pathname !== '/' && url.pathname !== '') {
    throw new Error(
      `CORS_ALLOWED_ORIGINS entry must not contain a path: "${trimmed}"`,
    );
  }

  if (url.search || url.hash) {
    throw new Error(
      `CORS_ALLOWED_ORIGINS entry must not contain a query string or fragment: "${trimmed}"`,
    );
  }

  // `url.origin` is the platform-normalized "scheme://host[:port]" form
  // (lowercased scheme+host, default ports omitted) — exactly the shape an
  // incoming `Origin` header arrives in, so the allowlist comparison in
  // main.ts can be a plain string match.
  return url.origin.toLowerCase();
}
