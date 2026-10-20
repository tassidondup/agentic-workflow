import { escapeControl } from './cli-pr.js';
import type { Io } from './cli.js';
import { isNonce } from './canary.js';
import { realExec } from './exec.js';
import { assertSafeRepoPath } from './paths.js';
import { runTests } from './run-tests.js';
import { UsageError } from './usage-error.js';

export type RunFlags = Readonly<Partial<Record<'report-out' | 'base' | 'canary', string>> & { isolate?: boolean }>;

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

/** `--canary` is this run's nonce; anything but 16 to 64 lowercase hex characters is a usage error (exit 2). */
function needCanary(flags: RunFlags): string | undefined {
  const value = flags.canary;
  if (value === undefined) return undefined;
  if (!isNonce(value)) throw new UsageError('--canary must be 16 to 64 lowercase hex characters');
  return value;
}

/**
 * Runs the configured setup and test command. With `--base <ref>` the test settings come from that commit, not the
 * working tree; `--isolate` runs each step in a container from `test.image`; `--canary <nonce>` adds the must-fail
 * canary test and passes only if it failed and nothing else did. The runner's own output is passed through as-is;
 * any non-zero status is exit 1. Config or report problems throw (exit 2), with control characters escaped.
 */
export function runRunTests(root: string, flags: RunFlags, io: Io): number {
  const reportOut = needReportOut(flags);
  const canary = needCanary(flags);
  try {
    const r = runTests(root, io.exec ?? realExec, { reportOut, base: flags.base, isolate: flags.isolate === true, canary });
    if (r.output !== '') io.out(r.output.replace(/\n$/, ''));
    return r.status === 0 ? 0 : 1;
  } catch (e) {
    throw new Error(escapeControl((e as Error).message));
  }
}
