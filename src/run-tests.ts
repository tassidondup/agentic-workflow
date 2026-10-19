import { loadConfig } from './config.js';
import type { Exec } from './exec.js';
import { assertSafeRepoPath } from './paths.js';
import { lstatInRepo, readRepoFile, removeRepoFile, writeRepoFile } from './safe-fs.js';

export interface TestRun {
  readonly status: number;
  /** Stdout then stderr of every command that ran, as the test runner printed it. */
  readonly output: string;
}

function runStep(exec: Exec, command: readonly string[], root: string): TestRun {
  const [cmd, ...args] = command;
  if (cmd === undefined) throw new Error('Empty command');
  const r = exec(cmd, args, root);
  return { status: r.status, output: r.stdout + r.stderr };
}

/**
 * Runs `test.setup` (if any) then `test.command` in `root` and stops at the first non-zero status.
 * With `reportOut`, a successful run also copies `test.junitReport` to that repo path, so a CI job
 * can upload it. Config and report problems throw; test failures are the returned status.
 */
export function runTests(root: string, exec: Exec, reportOut?: string): TestRun {
  const out = reportOut === undefined ? undefined : assertSafeRepoPath(reportOut);
  const { test } = loadConfig(root);
  let output = '';
  if (test.setup) {
    const setup = runStep(exec, test.setup, root);
    output += setup.output;
    if (setup.status !== 0) return { status: setup.status, output };
  }
  // Removed after setup, right before the command: only a report this run writes may be copied,
  // never one committed to the repo or left behind by setup.
  removeRepoFile(root, test.junitReport);
  const main = runStep(exec, test.command, root);
  output += main.output;
  if (main.status !== 0 || out === undefined) return { status: main.status, output };
  if (lstatInRepo(root, test.junitReport) === null) {
    throw new Error(`The test command did not write ${test.junitReport}. Configure your runner's JUnit reporter.`);
  }
  writeRepoFile(root, out, readRepoFile(root, test.junitReport));
  return { status: 0, output };
}
