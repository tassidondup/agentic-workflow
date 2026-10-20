import { baseConfig } from './base-config.js';
import { canaryName, canaryProblems, isNonce, removeCanary, writeCanary } from './canary.js';
import { loadConfig, type WorkflowConfig } from './config.js';
import type { Exec } from './exec.js';
import { runIsolated } from './isolate.js';
import { parseJUnit } from './junit.js';
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

const fail = (message: string): never => {
  throw new Error(message);
};

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

export interface RunOptions {
  /** Copy the JUnit report here after a successful run. */
  readonly reportOut?: string;
  /** Read the test settings from this commit instead of the working tree. */
  readonly base?: string;
  /** Run setup (with the network) and the command (without) in containers from `test.image`. */
  readonly isolate?: boolean;
  /** This run's nonce: write the must-fail canary test and require it to fail in the report. */
  readonly canary?: string;
}

const failing = (output: string, why: readonly string[]): TestRun => ({ status: 1, output: output + why.map((w) => `wf: ${w}\n`).join('') });

/** Decides a run that included the canary from its report. Throws on an unreadable report; test failures are the status. */
function canaryRun(root: string, test: WorkflowConfig['test'], nonce: string, main: TestRun, output: string): TestRun {
  const canary = test.canary;
  if (canary === undefined) throw new Error('test.canary is not set');
  if (lstatInRepo(root, test.junitReport) === null) {
    if (main.status !== 0) return { status: main.status, output };
    throw new Error(`The test command did not write ${test.junitReport}. Configure your runner's JUnit reporter.`);
  }
  const cases = parseJUnit(readRepoFile(root, test.junitReport, 'utf8'));
  const problems = canaryProblems(root, canary, cases, nonce);
  if (problems.length > 0) return failing(output, problems);
  const name = canaryName(nonce);
  if (cases.some((c) => !c.name.includes(name) && c.status === 'failed')) return { status: main.status === 0 ? 1 : main.status, output };
  if (main.status === 0) return failing(output, [`the test command exited 0 although the canary failed in its report, so the exit status and the report disagree`]);
  return { status: 0, output: `${output}wf: canary failed as expected\n` };
}

/**
 * Runs `test.setup` (if any) then `test.command` in `root` and stops at the first non-zero status.
 * With `reportOut`, a successful run also copies `test.junitReport` to that repo path, so a CI job
 * can upload it. Config and report problems throw; test failures are the returned status.
 * With `base`, the test settings come from that commit instead of the working tree, so a PR cannot swap
 * in a command that passes without running its tests.
 * With `isolate`, each step runs in a fresh container from `test.image`: setup with the network, the command
 * without it, so nothing the tests start outlives the run (ADR 0002 layer 2).
 * With `canary`, a must-fail test is written before the command; the run counts as passing when the canary failed
 * and nothing else did (ADR 0002 layer 1).
 */
export function runTests(root: string, exec: Exec, options: RunOptions = {}): TestRun {
  const out = options.reportOut === undefined ? undefined : assertSafeRepoPath(options.reportOut);
  const { test, note } = testSettings(root, exec, options.base);
  const image = options.isolate === true ? test.image ?? fail('test.image is not set; --isolate needs a container image') : undefined;
  const nonce = options.canary;
  if (nonce !== undefined && !isNonce(nonce)) throw new Error('The canary nonce must be 16 to 64 lowercase hex characters');
  if (nonce !== undefined && test.canary === undefined) throw new Error('test.canary is not set; --canary needs a template and a path');
  const step = (argv: readonly string[], network: 'none' | 'bridge'): TestRun =>
    image === undefined ? runStep(exec, argv, root) : runIsolated(exec, image, root, argv, network);
  let output = note;
  if (test.setup) {
    const setup = step(test.setup, 'bridge');
    output += setup.output;
    if (setup.status !== 0) return { status: setup.status, output };
  }
  // Removed after setup, right before the command: only a report this run writes may be copied,
  // never one committed to the repo or left behind by setup.
  removeRepoFile(root, test.junitReport);
  if (nonce !== undefined && test.canary !== undefined) writeCanary(root, test.canary, nonce);
  let main: TestRun;
  let decided: TestRun;
  try {
    main = step(test.command, 'none');
    output += main.output;
    decided = nonce === undefined ? main : canaryRun(root, test, nonce, main, output);
  } finally {
    if (nonce !== undefined && test.canary !== undefined) removeCanary(root, test.canary);
  }
  if (nonce === undefined) {
    if (main.status !== 0 || out === undefined) return { status: main.status, output };
    if (lstatInRepo(root, test.junitReport) === null) {
      throw new Error(`The test command did not write ${test.junitReport}. Configure your runner's JUnit reporter.`);
    }
  } else if (decided.status !== 0 || out === undefined) {
    return decided;
  }
  writeRepoFile(root, out, readRepoFile(root, test.junitReport));
  return { status: 0, output: nonce === undefined ? output : decided.output };
}
