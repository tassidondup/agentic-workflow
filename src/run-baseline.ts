import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeBaseline, type Baseline, type BaselineInput } from './baseline.js';
import { baselineInputs } from './baseline-file.js';
import { readChange, readRetires } from './change.js';
import { loadConfig, type WorkflowConfig } from './config.js';
import { realExec, type Exec } from './exec.js';
import { canonicalJson } from './hash.js';
import { parseJUnit, type TestCase } from './junit.js';
import { changeRepoDir } from './paths.js';
import { lstatInRepo, readRepoFile, removeRepoFile, writeRepoFile } from './safe-fs.js';
import { changeRowIds, liveRowIds } from './spec-index.js';
import { promote, stagedFiles } from './stage.js';

function runIn(exec: Exec, command: readonly string[], cwd: string): number {
  const [cmd, ...args] = command;
  if (cmd === undefined) throw new Error('Empty command');
  return exec(cmd, args, cwd).status;
}

const quietly = (fn: () => void): void => {
  try {
    fn();
  } catch {
    // Swallowed deliberately: cleanup failures must not mask the original error/result.
  }
};

// Removes the worktree and the temp dir. Never throws: a failure here must not replace
// whatever error or result the main body already produced (controller ruling R12).
// The temp dir goes first, so a fallback `git worktree prune` sees it gone and drops the entry (M2).
function cleanupWorktree(exec: Exec, root: string, wt: string, tmp: string): void {
  let removed = false;
  quietly(() => {
    removed = exec('git', ['worktree', 'remove', '--force', wt], root).status === 0;
  });
  quietly(() => rmSync(tmp, { recursive: true, force: true }));
  if (!removed) quietly(() => exec('git', ['worktree', 'prune'], root));
}

// Promotes the staged tests into the worktree and removes any committed JUnit report, so the
// baseline can only read a report the test command wrote in this run (I5).
function stageIntoWorktree(wt: string, id: string, report: string): void {
  if (stagedFiles(wt, id, 'tests').some((f) => f.livePath.toLowerCase() === report.toLowerCase())) {
    throw new Error('Staging may not target the JUnit report path');
  }
  promote(wt, id, 'tests');
  removeRepoFile(wt, report);
}

type Inputs = Omit<BaselineInput, 'cases'>;

// Everything the baseline is measured against comes from the HEAD worktree, read before
// staging touches it, so the result describes exactly what is committed (I7).
function readInputs(wt: string, id: string): Inputs {
  return {
    id,
    changeRowIds: changeRowIds(wt, id),
    retired: readRetires(wt, id),
    live: liveRowIds(wt),
    noBehaviourChange: readChange(wt, id).noBehaviourChange,
    inputsSha256: baselineInputs(wt, id),
  };
}

function runTests(exec: Exec, config: WorkflowConfig, wt: string): TestCase[] {
  if (config.test.setup && runIn(exec, config.test.setup, wt) !== 0) {
    throw new Error(`Setup command failed: ${config.test.setup.join(' ')}`);
  }
  runIn(exec, config.test.command, wt);
  const report = config.test.junitReport;
  if (lstatInRepo(wt, report) === null) {
    throw new Error(`The test command did not write ${report}. Configure your runner's JUnit reporter.`);
  }
  return parseJUnit(readRepoFile(wt, report, 'utf8'));
}

const CONFIG = 'workflow.config.json';

// The baseline runs against HEAD, so everything it reads must be committed. Git-ignored files
// in the change folder are refused too: approve would hash them, but HEAD doesn't have them.
function assertCommitted(exec: Exec, root: string, dir: string): void {
  const status = (paths: string[], ignored = false): string[] =>
    exec('git', ['status', '--porcelain', ...(ignored ? ['--ignored'] : []), '--', ...paths], root).stdout
      .split('\n').filter((l) => l.trim() !== '');
  const clean = 'it runs against a clean checkout of HEAD';
  if (status([dir]).length > 0) throw new Error(`Commit ${dir} before running the baseline: ${clean}`);
  if (status([CONFIG]).length > 0) throw new Error(`Commit ${CONFIG} before running the baseline: ${clean}`);
  const ignored = status([dir], true).filter((l) => l.startsWith('!! ')).map((l) => l.slice(3));
  if (ignored.length > 0) throw new Error(`Remove git-ignored files from ${dir} before running the baseline: ${ignored.join(', ')}`);
}

export function runBaseline(root: string, id: string, exec: Exec = realExec): { baseline: Baseline | null; problems: readonly string[] } {
  const dir = changeRepoDir(id);
  assertCommitted(exec, root, dir);
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'wf-baseline-')));
  const wt = join(tmp, 'wt');
  try {
    const add = exec('git', ['worktree', 'add', '--detach', wt, 'HEAD'], root);
    if (add.status !== 0) throw new Error(`git worktree add failed: ${add.stderr.trim()}`);
    const config = loadConfig(wt);
    const inputs = readInputs(wt, id);
    stageIntoWorktree(wt, id, config.test.junitReport);
    const outcome = computeBaseline({ ...inputs, cases: runTests(exec, config, wt) });
    if (outcome.baseline) writeRepoFile(root, `${dir}/baseline.json`, canonicalJson(outcome.baseline));
    return outcome;
  } finally {
    cleanupWorktree(exec, root, wt, tmp);
  }
}
