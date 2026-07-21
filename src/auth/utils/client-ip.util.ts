import type { Request } from 'express';
import { sha256Hex } from './hash.util';

// IPv4-mapped IPv6 form (e.g. "::ffff:1.2.3.4") — stripped so it normalizes
// to the same value as the plain IPv4 address it represents.
const IPV4_MAPPED_PREFIX = '::ffff:';

/**
 * Normalizes a raw client IP so IPv4, IPv4-mapped IPv6, and native IPv6 all
 * produce a stable, comparable string. Never used to bypass Express's own
 * `trust proxy` handling — the caller must always pass `req.ip` (already
 * correctly derived from the configured trusted-hop count), never a
 * hand-parsed `X-Forwarded-For` value.
 */
export function normalizeIp(rawIp: string): string {
  const trimmed = rawIp.trim().toLowerCase();
  if (trimmed.startsWith(IPV4_MAPPED_PREFIX)) {
    return trimmed.slice(IPV4_MAPPED_PREFIX.length);
  }
  return trimmed;
}

/**
 * The raw, normalized client IP for this request. Exists only for callers
 * that must derive a hash locally — never persisted, logged, or placed in a
 * Redis key as-is (see `hashClientIp`/Sprint 01C's Redis key design).
 */
export function getClientIp(req: Request): string {
  return normalizeIp(req.ip ?? '');
}

/**
 * `sha256Hex(normalizedIp)`, truncated to 16 hex chars (64 bits) — the only
 * form of a client's IP that is ever written to a Redis rate-limit key or a
 * structured log line. Deterministic and unsalted by design: an operator
 * investigating a known-suspect IP can hash it locally and look up the same
 * key, which a salted/keyed hash would prevent. This is pseudonymization,
 * not anonymization — an accepted trade-off (see docs/memory.md).
 */
export function hashClientIp(req: Request): string {
  return sha256Hex(getClientIp(req)).slice(0, 16);
}
