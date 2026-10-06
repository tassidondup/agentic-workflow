import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeBaseline, type Baseline } from './baseline.js';
import { readChange } from './change.js';
import { loadConfig } from './config.js';
import { realExec, type Exec } from './exec.js';
import { canonicalJson } from './hash.js';
import { parseJUnit } from './junit.js';
import { changeDir, fromRepoPath, toRepoPath } from './paths.js';
import { changeRowIds, liveRowIds } from './spec-index.js';
import { promote } from './stage.js';

function runIn(exec: Exec, command: readonly string[], cwd: string): number {
  const [cmd, ...args] = command;
  if (cmd === undefined) throw new Error('Empty command');
  return exec(cmd, args, cwd).status;
}

export function runBaseline(root: string, id: string, exec: Exec = realExec): { baseline: Baseline | null; problems: readonly string[] } {
  const config = loadConfig(root);
  const meta = readChange(root, id);
  const testsDir = toRepoPath(root, join(changeDir(root, id), 'tests'));
  if (exec('git', ['status', '--porcelain', '--', testsDir], root).stdout.trim() !== '') {
    throw new Error('Commit the staged tests before running the baseline: it runs against a clean checkout of HEAD');
  }
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'wf-baseline-')));
  const wt = join(tmp, 'wt');
  const add = exec('git', ['worktree', 'add', '--detach', wt, 'HEAD'], root);
  if (add.status !== 0) throw new Error(`git worktree add failed: ${add.stderr.trim()}`);
  try {
    promote(wt, id, 'tests');
    if (config.test.setup && runIn(exec, config.test.setup, wt) !== 0) {
      throw new Error(`Setup command failed: ${config.test.setup.join(' ')}`);
    }
    runIn(exec, config.test.command, wt);
    const report = fromRepoPath(wt, config.test.junitReport);
    if (!existsSync(report)) {
      throw new Error(`The test command did not write ${config.test.junitReport}. Configure your runner's JUnit reporter.`);
    }
    const cases = parseJUnit(readFileSync(report, 'utf8'));
    const outcome = computeBaseline(id, changeRowIds(root, id), liveRowIds(root), cases, meta.noBehaviourChange);
    if (outcome.baseline) writeFileSync(join(changeDir(root, id), 'baseline.json'), canonicalJson(outcome.baseline));
    return outcome;
  } finally {
    const removed = exec('git', ['worktree', 'remove', '--force', wt], root);
    if (removed.status !== 0) exec('git', ['worktree', 'prune'], root);
    rmSync(tmp, { recursive: true, force: true });
  }
}
