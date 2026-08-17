// Pure CLI argument parsing — no env reads, no process.exit, so it is
// trivially unit-testable.

export interface BootstrapCliArgs {
  readonly apply: boolean;
  readonly verifyOnly: boolean;
  readonly confirmDb: string | undefined;
  /**
   * A separate, literal acknowledgement flag required alongside --confirm-db
   * for --apply. --confirm-db alone is not strong enough: Railway's default
   * Postgres database name is literally "railway" for every project, so
   * typing it back is a weak, near-constant signal. --confirm-production has
   * no value to guess — it only proves the operator meant to type it.
   */
  readonly confirmProduction: boolean;
}

export const parseCliArgs = (argv: readonly string[]): BootstrapCliArgs => {
  const apply = argv.includes('--apply');
  const verifyOnly = argv.includes('--verify-only');
  const confirmProduction = argv.includes('--confirm-production');
  const confirmDbIndex = argv.indexOf('--confirm-db');
  const confirmDb =
    confirmDbIndex >= 0 && confirmDbIndex + 1 < argv.length
      ? argv[confirmDbIndex + 1]
      : undefined;
  return { apply, verifyOnly, confirmDb, confirmProduction };
};
