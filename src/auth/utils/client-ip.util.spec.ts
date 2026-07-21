import type { Request } from 'express';
import { getClientIp, hashClientIp, normalizeIp } from './client-ip.util';

const requestWithIp = (ip: string): Request => ({ ip }) as unknown as Request;

describe('client-ip.util', () => {
  describe('normalizeIp', () => {
    it('passes a plain IPv4 address through unchanged (besides trim/case)', () => {
      expect(normalizeIp('203.0.113.42')).toBe('203.0.113.42');
    });

    it('strips the IPv4-mapped IPv6 prefix', () => {
      expect(normalizeIp('::ffff:203.0.113.42')).toBe('203.0.113.42');
    });

    it('lowercases a native IPv6 address', () => {
      expect(normalizeIp('2001:DB8::1')).toBe('2001:db8::1');
    });

    it('trims surrounding whitespace', () => {
      expect(normalizeIp('  203.0.113.42  ')).toBe('203.0.113.42');
    });
  });

  describe('getClientIp / hashClientIp', () => {
    it('IPv4 and its IPv4-mapped IPv6 form produce the same hash', () => {
      const plain = hashClientIp(requestWithIp('203.0.113.42'));
      const mapped = hashClientIp(requestWithIp('::ffff:203.0.113.42'));
      expect(plain).toBe(mapped);
    });

    it('different IPs produce different hashes', () => {
      const a = hashClientIp(requestWithIp('203.0.113.42'));
      const b = hashClientIp(requestWithIp('203.0.113.43'));
      expect(a).not.toBe(b);
    });

    it('the same IP always hashes deterministically', () => {
      const first = hashClientIp(requestWithIp('198.51.100.7'));
      const second = hashClientIp(requestWithIp('198.51.100.7'));
      expect(first).toBe(second);
    });

    it('never returns the raw IP itself as the hash', () => {
      const ip = '198.51.100.7';
      expect(hashClientIp(requestWithIp(ip))).not.toBe(ip);
      expect(getClientIp(requestWithIp(ip))).toBe(ip);
    });

    it('native IPv6 addresses normalize and hash consistently regardless of case', () => {
      const lower = hashClientIp(requestWithIp('2001:db8::1'));
      const upper = hashClientIp(requestWithIp('2001:DB8::1'));
      expect(lower).toBe(upper);
    });
  });
});
