import { assertTestDatabaseUrl, testFixtureName, TEST_FIXTURE_PREFIX } from './test-database.util';

/**
 * Regression coverage for the test-database guard itself (Sprint 04D). This
 * is the check that would have caught the original leak: a suite pointed at
 * the development database, or run outside NODE_ENV=test, must fail loudly
 * before it ever creates a row — not rely on cleanup succeeding.
 */
describe('test database guard', () => {
  const validTestUrl = 'postgresql://user:pass@localhost:5432/engmasterai_test?schema=public';

  it('accepts a properly named test database under NODE_ENV=test', () => {
    expect(() => assertTestDatabaseUrl(validTestUrl, 'test')).not.toThrow();
  });

  it('rejects the development database by exact name, even under NODE_ENV=test', () => {
    const devUrl = 'postgresql://user:pass@localhost:5432/engmasterai?schema=public';
    expect(() => assertTestDatabaseUrl(devUrl, 'test')).toThrow(/development database/i);
  });

  it('rejects any database whose name does not end in "_test"', () => {
    const otherUrl = 'postgresql://user:pass@localhost:5432/engmasterai_staging?schema=public';
    expect(() => assertTestDatabaseUrl(otherUrl, 'test')).toThrow(/must end in "_test"/i);
  });

  it('rejects NODE_ENV values other than "test", even against a correctly named database', () => {
    expect(() => assertTestDatabaseUrl(validTestUrl, 'development')).toThrow(/NODE_ENV must be "test"/i);
    expect(() => assertTestDatabaseUrl(validTestUrl, undefined)).toThrow(/NODE_ENV must be "test"/i);
  });

  it('rejects a missing DATABASE_URL with an actionable message', () => {
    expect(() => assertTestDatabaseUrl(undefined, 'test')).toThrow(/DATABASE_URL is not set/i);
  });

  it('never includes the database URL (credentials) in its error message', () => {
    const devUrl = 'postgresql://secretuser:secretpass@localhost:5432/engmasterai?schema=public';
    try {
      assertTestDatabaseUrl(devUrl, 'test');
      throw new Error('expected assertTestDatabaseUrl to throw');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain('secretuser');
      expect(message).not.toContain('secretpass');
    }
  });
});

describe('testFixtureName', () => {
  it('always starts with the shared fixture prefix, so the global sweep can find it', () => {
    expect(testFixtureName('Progress Deck A')).toMatch(
      new RegExp(`^${TEST_FIXTURE_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} Progress Deck A `),
    );
  });

  it('produces a distinct name on every call, so repeated runs never collide', () => {
    expect(testFixtureName('Progress Deck A')).not.toBe(testFixtureName('Progress Deck A'));
  });
});
