import {
  isValidTrustProxyValue,
  resolveTrustProxyValue,
} from './trust-proxy.util';

describe('trust-proxy.util', () => {
  describe('isValidTrustProxyValue', () => {
    it('accepts "false" and empty', () => {
      expect(isValidTrustProxyValue('false')).toBe(true);
      expect(isValidTrustProxyValue('')).toBe(true);
    });

    it('rejects the bare literal "true"', () => {
      expect(isValidTrustProxyValue('true')).toBe(false);
    });

    it('accepts a positive hop count', () => {
      expect(isValidTrustProxyValue('1')).toBe(true);
      expect(isValidTrustProxyValue('2')).toBe(true);
    });

    it('accepts an IP-like value', () => {
      expect(isValidTrustProxyValue('10.0.0.1')).toBe(true);
      expect(isValidTrustProxyValue('10.0.0.0/8')).toBe(true);
    });

    it('rejects garbage', () => {
      expect(isValidTrustProxyValue('yes-please')).toBe(false);
    });
  });

  describe('resolveTrustProxyValue', () => {
    it('resolves "false"/empty to boolean false', () => {
      expect(resolveTrustProxyValue('false')).toBe(false);
      expect(resolveTrustProxyValue('')).toBe(false);
    });

    it('resolves a hop count to a number', () => {
      expect(resolveTrustProxyValue('1')).toBe(1);
    });

    it('resolves an IP/CIDR to the string as-is', () => {
      expect(resolveTrustProxyValue('10.0.0.0/8')).toBe('10.0.0.0/8');
    });
  });
});
