import { baseConfig } from './base-config.js';
import { loadConfig, type WorkflowConfig } from './config.js';
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

const BASE_USE = 'the test settings';

/** Where the test settings come from: the working tree, or the base commit when CI judges a PR. */
function testSettings(root: string, exec: Exec, base: string | undefined): { test: WorkflowConfig['test']; note: string } {
  if (base === undefined) return { test: loadConfig(root).test, note: '' };
  const found = baseConfig(root, base, exec, BASE_USE);
  if ('problem' in found) throw new Error(found.problem);
  let changed = false;
  try {
    changed = JSON.stringify(loadConfig(root).test) !== JSON.stringify(found.config.test);
  } catch {
    changed = true; // the PR's own config is unreadable, which is itself a difference worth showing
  }
  const note = changed ? `wf: the test settings in workflow.config.json differ from ${base}; using ${base}'s (a change to them takes effect once it is merged)\n` : '';
  return { test: found.config.test, note };
}

/**
 * Runs `test.setup` (if any) then `test.command` in `root` and stops at the first non-zero status.
 * With `reportOut`, a successful run also copies `test.junitReport` to that repo path, so a CI job
 * can upload it. Config and report problems throw; test failures are the returned status.
 * With `base`, the test settings come from that commit instead of the working tree, so a PR cannot swap
 * in a command that passes without running its tests.
 */
export function runTests(root: string, exec: Exec, reportOut?: string, base?: string): TestRun {
  const out = reportOut === undefined ? undefined : assertSafeRepoPath(reportOut);
  const { test, note } = testSettings(root, exec, base);
  let output = note;
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
