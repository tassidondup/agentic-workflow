import { escapeControl } from './cli-pr.js';
import type { Io } from './cli.js';
import { realExec } from './exec.js';
import { assertSafeRepoPath } from './paths.js';
import { runTests } from './run-tests.js';
import { UsageError } from './usage-error.js';

export type RunFlags = Readonly<Partial<Record<'report-out', string>>>;

/** `--report-out` is a repo-relative path; anything else is a usage error (exit 2). */
function needReportOut(flags: RunFlags): string | undefined {
  const value = flags['report-out'];
  if (value === undefined) return undefined;
  try {
    return assertSafeRepoPath(value);
  } catch (e) {
    throw new UsageError(`--report-out ${escapeControl((e as Error).message)}`);
  }
}

/**
 * Runs the configured setup and test command. The runner's own output is passed through as-is;
 * any non-zero status is exit 1. Config or report problems throw (exit 2), with control characters escaped.
 */
export function runRunTests(root: string, flags: RunFlags, io: Io): number {
  const reportOut = needReportOut(flags);
  try {
    const r = runTests(root, io.exec ?? realExec, reportOut);
    if (r.output !== '') io.out(r.output.replace(/\n$/, ''));
    return r.status === 0 ? 0 : 1;
  } catch (e) {
    throw new Error(escapeControl((e as Error).message));
  }
}
