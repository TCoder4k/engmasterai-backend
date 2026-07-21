import { parseAllowedOrigins } from './cors-origins.util';

describe('parseAllowedOrigins', () => {
  it('returns an empty array for an empty/unset value', () => {
    expect(parseAllowedOrigins(undefined)).toEqual([]);
    expect(parseAllowedOrigins('')).toEqual([]);
    expect(parseAllowedOrigins('   ')).toEqual([]);
  });

  it('parses a single origin', () => {
    expect(parseAllowedOrigins('https://app.example.com')).toEqual([
      'https://app.example.com',
    ]);
  });

  it('parses multiple comma-separated origins and trims whitespace', () => {
    expect(
      parseAllowedOrigins(
        ' https://app.example.com , https://admin.example.com ',
      ),
    ).toEqual(['https://app.example.com', 'https://admin.example.com']);
  });

  it('lowercases scheme and host', () => {
    expect(parseAllowedOrigins('HTTPS://App.Example.com')).toEqual([
      'https://app.example.com',
    ]);
  });

  it('omits a default port from the normalized form', () => {
    expect(parseAllowedOrigins('https://app.example.com:443')).toEqual([
      'https://app.example.com',
    ]);
  });

  it('rejects a bare wildcard', () => {
    expect(() => parseAllowedOrigins('*')).toThrow(/wildcard/);
  });

  it('rejects an entry with a path', () => {
    expect(() => parseAllowedOrigins('https://app.example.com/login')).toThrow(
      /path/,
    );
  });

  it('rejects an entry with a query string', () => {
    expect(() => parseAllowedOrigins('https://app.example.com?x=1')).toThrow(
      /query/,
    );
  });

  it('rejects a malformed URL', () => {
    expect(() => parseAllowedOrigins('not a url')).toThrow(
      /valid absolute URL/,
    );
  });

  it('rejects a non-http(s) scheme', () => {
    expect(() => parseAllowedOrigins('ftp://example.com')).toThrow(
      /http:\/\/ or https:\/\//,
    );
  });

  it('rejects an empty entry in a comma-separated list', () => {
    expect(() => parseAllowedOrigins('https://app.example.com,,')).toThrow(
      /empty entry/,
    );
  });
});
