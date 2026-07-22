import { normalizeEmail } from './email.util';

describe('normalizeEmail', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizeEmail('  user@example.com  ')).toBe('user@example.com');
  });

  it('lowercases using locale-independent behavior', () => {
    expect(normalizeEmail('User@Example.COM')).toBe('user@example.com');
  });

  it('handles combined uppercase and surrounding whitespace together', () => {
    expect(normalizeEmail('  Jane.Doe@Example.COM ')).toBe(
      'jane.doe@example.com',
    );
  });

  it('does not strip dots — distinct local-parts remain distinct', () => {
    expect(normalizeEmail('john.doe@example.com')).toBe('john.doe@example.com');
    expect(normalizeEmail('johndoe@example.com')).not.toBe(
      normalizeEmail('john.doe@example.com'),
    );
  });

  it('does not strip plus-address tags — distinct local-parts remain distinct', () => {
    expect(normalizeEmail('user+tag@example.com')).toBe('user+tag@example.com');
    expect(normalizeEmail('user@example.com')).not.toBe(
      normalizeEmail('user+tag@example.com'),
    );
  });

  it('is idempotent — normalizing an already-normalized value is a no-op', () => {
    const once = normalizeEmail('User@Example.com');
    expect(normalizeEmail(once)).toBe(once);
  });
});
