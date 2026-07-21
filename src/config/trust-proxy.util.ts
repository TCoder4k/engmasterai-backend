// TRUST_PROXY (Sprint 01C) — controls what Express's `req.ip` trusts.
// Deliberately never accepts a bare "true" (trusts every hop
// unconditionally, the exact misconfiguration this exists to prevent);
// only a hop count or a specific trusted proxy IP/CIDR is accepted, which
// Express's own `trust proxy` setting implements correctly — no
// hand-rolled X-Forwarded-For parsing anywhere in this codebase.

const HOP_COUNT_PATTERN = /^[1-9][0-9]*$/;
// Loose IPv4 / IPv6 / CIDR character-set check — Express validates the
// actual semantics once `app.set('trust proxy', ...)` receives the value;
// this only screens out obviously-wrong input at startup.
const ADDRESS_LIKE_PATTERN = /^[0-9a-fA-F:./]+$/;

export function isValidTrustProxyValue(raw: string): boolean {
  const value = raw.trim();
  if (value.length === 0 || value === 'false') return true;
  if (value === 'true') return false;
  return HOP_COUNT_PATTERN.test(value) || ADDRESS_LIKE_PATTERN.test(value);
}

/** Converts the validated string form into what `app.set('trust proxy', ...)` expects. */
export function resolveTrustProxyValue(raw: string): boolean | number | string {
  const value = raw.trim();
  if (value.length === 0 || value === 'false') return false;
  if (HOP_COUNT_PATTERN.test(value)) return Number(value);
  return value;
}
