import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { realExec, type Exec } from '../src/exec.js';
import { runBaseline } from '../src/run-baseline.js';
import { git, makeRepo, type TestRepo } from './helpers/repo.js';

let repo: TestRepo;
afterEach(() => repo?.cleanup());
const runner = resolve('test/helpers/fake-runner.mjs');
const C = 'docs/changes/c1';
const table = '| ID | Price | Expected |\n|---|---|---|\n| LST-001 | 1 | 201 |\n| LST-002 | 0 | 422 |\n';
const rowsJson = JSON.stringify({ rows: [{ id: 'LST-001', title: 'valid', existing: true }, { id: 'LST-002', title: 'rejects 0' }] });

function setup(extraConfig: Record<string, unknown> = {}): void {
  repo = makeRepo({
    'workflow.config.json': JSON.stringify({ approvers: ['tassi'], test: { command: ['node', runner], junitReport: 'reports/junit.xml', ...extraConfig } }),
    'docs/specs/listing/spec.md': '| ID | Price | Expected |\n|---|---|---|\n| LST-001 | 1 | 201 |\n',
    [`${C}/spec-delta.md`]: table,
    [`${C}/change.json`]: '{"level":"P1","noBehaviourChange":false}',
    [`${C}/tests/stage/tests/acceptance/rows.json`]: rowsJson,
  });
  git(repo.root, 'init', '-q', '-b', 'main');
  git(repo.root, 'add', '.');
  git(repo.root, 'commit', '-q', '-m', 'init');
}

describe('runBaseline', () => {
  it('runs staged tests in a temp worktree and writes baseline.json', () => {
    setup();
    const r = runBaseline(repo.root, 'c1');
    expect(r.problems).toEqual([]);
    expect(JSON.parse(readFileSync(join(repo.root, C, 'baseline.json'), 'utf8')).rows).toEqual({ 'LST-001': 'passes', 'LST-002': 'fails' });
    expect(existsSync(join(repo.root, 'tests', 'acceptance', 'rows.json'))).toBe(false);
    expect(git(repo.root, 'worktree', 'list').trim().split('\n')).toHaveLength(1);
  });

  it('refuses when staged tests are not committed', () => {
    setup();
    repo.write(`${C}/tests/stage/tests/acceptance/extra.test.ts`, 'x');
    expect(() => runBaseline(repo.root, 'c1')).toThrow(/Commit the staged tests/);
  });

  it('errors when the test command writes no JUnit report, and cleans up (Review Focus 3)', () => {
    setup();
    const exec: Exec = (cmd, args, cwd) => realExec(cmd === 'node' ? 'env' : cmd, cmd === 'node' ? ['FAKE_NO_REPORT=1', 'node', ...args] : args, cwd);
    expect(() => runBaseline(repo.root, 'c1', exec)).toThrow(/did not write reports\/junit\.xml/);
    expect(existsSync(join(repo.root, C, 'baseline.json'))).toBe(false);
    expect(git(repo.root, 'worktree', 'list').trim().split('\n')).toHaveLength(1);
  });

  it('fails when the setup command fails', () => {
    setup({ setup: ['node', '-e', 'process.exit(3)'] });
    expect(() => runBaseline(repo.root, 'c1')).toThrow(/Setup command failed/);
  });
});
