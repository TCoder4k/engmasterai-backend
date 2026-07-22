import { randomBytes } from 'crypto';
import { sha256Hex } from '../utils/hash.util';

export interface GeneratedSecureToken {
  /** Handed to the caller for embedding in an email link — never persisted. */
  raw: string;
  /** The only form ever written to the database. */
  hash: string;
}

/**
 * Generates a high-entropy, single-use, opaque token for the email
 * verification (Sprint 02B) and, later, password reset (Sprint 02C) flows.
 * 256 bits of `crypto.randomBytes` already makes brute force infeasible, so
 * the stored form is a plain `sha256Hex()` digest — the same primitive
 * `TokenBlacklistService` already uses to store a high-entropy bearer value
 * — not a slow/salted KDF (unnecessary for a value this random) and not a
 * JWT (this design needs a DB hit anyway to enforce single-use, so a JWT's
 * self-describing property buys nothing here — see docs/adr/005).
 */
export const generateSecureToken = (): GeneratedSecureToken => {
  const raw = randomBytes(32).toString('base64url');
  return { raw, hash: sha256Hex(raw) };
};
