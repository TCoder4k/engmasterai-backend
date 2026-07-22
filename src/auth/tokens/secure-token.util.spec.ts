import { generateSecureToken } from './secure-token.util';
import { sha256Hex } from '../utils/hash.util';

describe('generateSecureToken', () => {
  it('returns a raw token and its sha256 hash, and they are different values', () => {
    const { raw, hash } = generateSecureToken();
    expect(raw).toBeTruthy();
    expect(hash).toBeTruthy();
    expect(raw).not.toBe(hash);
  });

  it('the hash is exactly sha256Hex(raw) — the same primitive used elsewhere in this codebase', () => {
    const { raw, hash } = generateSecureToken();
    expect(hash).toBe(sha256Hex(raw));
  });

  it('produces a 256-bit (32-byte) raw token, base64url-encoded', () => {
    const { raw } = generateSecureToken();
    // base64url never contains '+', '/', or '=' padding.
    expect(raw).not.toMatch(/[+/=]/);
    expect(Buffer.from(raw, 'base64url').length).toBe(32);
  });

  it('generates a different token on every call (no reuse)', () => {
    const first = generateSecureToken();
    const second = generateSecureToken();
    expect(first.raw).not.toBe(second.raw);
    expect(first.hash).not.toBe(second.hash);
  });

  it('the hash is a 64-character hex string (full SHA-256 digest, not truncated)', () => {
    const { hash } = generateSecureToken();
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
