import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeBaseline, type Baseline } from './baseline.js';
import { readChange } from './change.js';
import { loadConfig } from './config.js';
import { realExec, type Exec } from './exec.js';
import { canonicalJson } from './hash.js';
import { parseJUnit } from './junit.js';
import { changeRepoDir } from './paths.js';
import { lstatInRepo, readRepoFile, removeRepoFile, writeRepoFile } from './safe-fs.js';
import { changeRowIds, liveRowIds } from './spec-index.js';
import { promote, stagedFiles } from './stage.js';

function runIn(exec: Exec, command: readonly string[], cwd: string): number {
  const [cmd, ...args] = command;
  if (cmd === undefined) throw new Error('Empty command');
  return exec(cmd, args, cwd).status;
}

// Removes the worktree and the temp dir. Never throws: a failure here must not replace
// whatever error or result the main body already produced (controller ruling R12).
function cleanupWorktree(exec: Exec, root: string, wt: string, tmp: string): void {
  try {
    const removed = exec('git', ['worktree', 'remove', '--force', wt], root);
    if (removed.status !== 0) exec('git', ['worktree', 'prune'], root);
  } catch {
    // Swallowed deliberately: cleanup failures must not mask the original error/result.
  }
  rmSync(tmp, { recursive: true, force: true });
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

export function runBaseline(root: string, id: string, exec: Exec = realExec): { baseline: Baseline | null; problems: readonly string[] } {
  const config = loadConfig(root);
  const meta = readChange(root, id);
  const testsDir = `${changeRepoDir(id)}/tests`;
  if (exec('git', ['status', '--porcelain', '--', testsDir], root).stdout.trim() !== '') {
    throw new Error('Commit the staged tests before running the baseline: it runs against a clean checkout of HEAD');
  }
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'wf-baseline-')));
  const wt = join(tmp, 'wt');
  try {
    const add = exec('git', ['worktree', 'add', '--detach', wt, 'HEAD'], root);
    if (add.status !== 0) throw new Error(`git worktree add failed: ${add.stderr.trim()}`);
    stageIntoWorktree(wt, id, config.test.junitReport);
    if (config.test.setup && runIn(exec, config.test.setup, wt) !== 0) {
      throw new Error(`Setup command failed: ${config.test.setup.join(' ')}`);
    }
    runIn(exec, config.test.command, wt);
    const report = config.test.junitReport;
    if (lstatInRepo(wt, report) === null) {
      throw new Error(`The test command did not write ${config.test.junitReport}. Configure your runner's JUnit reporter.`);
    }
    const cases = parseJUnit(readRepoFile(wt, report, 'utf8'));
    const outcome = computeBaseline(id, changeRowIds(root, id), liveRowIds(root), cases, meta.noBehaviourChange);
    if (outcome.baseline) writeRepoFile(root, `${changeRepoDir(id)}/baseline.json`, canonicalJson(outcome.baseline));
    return outcome;
  } finally {
    cleanupWorktree(exec, root, wt, tmp);
  }
}
