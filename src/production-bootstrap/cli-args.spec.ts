import { parseCliArgs } from './cli-args';

describe('parseCliArgs', () => {
  it('defaults to a read-only dry run with no flags', () => {
    expect(parseCliArgs([])).toEqual({
      apply: false,
      verifyOnly: false,
      confirmDb: undefined,
      confirmProduction: false,
    });
  });

  it('recognizes --confirm-production as its own independent flag', () => {
    expect(parseCliArgs(['--apply', '--confirm-production']).confirmProduction).toBe(true);
  });

  it('does not infer --confirm-production from --confirm-db', () => {
    expect(parseCliArgs(['--apply', '--confirm-db', 'railway']).confirmProduction).toBe(false);
  });

  it('recognizes --apply', () => {
    expect(parseCliArgs(['--apply']).apply).toBe(true);
  });

  it('recognizes --verify-only', () => {
    expect(parseCliArgs(['--verify-only']).verifyOnly).toBe(true);
  });

  it('reads the value following --confirm-db', () => {
    expect(parseCliArgs(['--apply', '--confirm-db', 'railway']).confirmDb).toBe('railway');
  });

  it('leaves confirmDb undefined when --confirm-db has no following value', () => {
    expect(parseCliArgs(['--apply', '--confirm-db']).confirmDb).toBeUndefined();
  });

  it('leaves confirmDb undefined when --confirm-db is absent', () => {
    expect(parseCliArgs(['--apply']).confirmDb).toBeUndefined();
  });
});
