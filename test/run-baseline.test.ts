import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
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

  it('removes the temp dir when git worktree add fails (fix round 1, Important)', () => {
    setup();
    let worktreePath: string | undefined;
    const exec: Exec = (cmd, args, cwd) => {
      if (cmd === 'git' && args[0] === 'worktree' && args[1] === 'add') {
        worktreePath = args[3];
        return { status: 1, stdout: '', stderr: 'boom' };
      }
      return realExec(cmd, args, cwd);
    };
    expect(() => runBaseline(repo.root, 'c1', exec)).toThrow(/git worktree add failed/);
    expect(worktreePath).toBeDefined();
    expect(existsSync(dirname(worktreePath as string))).toBe(false);
  });

  it('falls back to worktree prune when removal fails, but still returns the result (R12)', () => {
    setup();
    const calls: string[][] = [];
    const exec: Exec = (cmd, args, cwd) => {
      calls.push([cmd, ...args]);
      if (cmd === 'git' && args[0] === 'worktree' && args[1] === 'remove') {
        return { status: 1, stdout: '', stderr: 'locked' };
      }
      return realExec(cmd, args, cwd);
    };
    const r = runBaseline(repo.root, 'c1', exec);
    expect(r.problems).toEqual([]);
    expect(calls.some((c) => c[0] === 'git' && c[1] === 'worktree' && c[2] === 'prune')).toBe(true);
  });

  it('surfaces the original error even if cleanup itself throws (R12)', () => {
    setup();
    const exec: Exec = (cmd, args, cwd) => {
      if (cmd === 'git' && args[0] === 'worktree' && args[1] === 'remove') {
        throw new Error('cleanup exploded');
      }
      if (cmd === 'node') {
        return realExec('env', ['FAKE_NO_REPORT=1', 'node', ...args], cwd);
      }
      return realExec(cmd, args, cwd);
    };
    expect(() => runBaseline(repo.root, 'c1', exec)).toThrow(/did not write reports\/junit\.xml/);
  });

  it('refuses to write baseline.json through a committed symlink and leaves the target unchanged (C1)', () => {
    const outside = mkdtempSync(join(tmpdir(), 'wf-outside-'));
    const target = join(outside, 'victim.json');
    writeFileSync(target, 'original');
    try {
      setup();
      symlinkSync(target, join(repo.root, C, 'baseline.json'));
      git(repo.root, 'add', '.');
      git(repo.root, 'commit', '-q', '-m', 'link');
      expect(() => runBaseline(repo.root, 'c1')).toThrow(/Symlinks are not allowed: docs\/changes\/c1\/baseline\.json/);
      expect(readFileSync(target, 'utf8')).toBe('original');
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('deletes a committed JUnit report before running, so a silent runner fails (I5)', () => {
    setup();
    repo.write('reports/junit.xml', '<testsuite name="stale"><testcase classname="c" name="[LST-002] stale pass"/></testsuite>');
    git(repo.root, 'add', '.');
    git(repo.root, 'commit', '-q', '-m', 'stale report');
    const exec: Exec = (cmd, args, cwd) => realExec(cmd === 'node' ? 'env' : cmd, cmd === 'node' ? ['FAKE_NO_REPORT=1', 'node', ...args] : args, cwd);
    expect(() => runBaseline(repo.root, 'c1', exec)).toThrow(/did not write reports\/junit\.xml/);
    expect(existsSync(join(repo.root, C, 'baseline.json'))).toBe(false);
  });

  it('refuses staged tests that target the JUnit report path (I5)', () => {
    setup();
    repo.write(`${C}/tests/stage/Reports/JUnit.xml`, '<testsuite name="forged"/>');
    git(repo.root, 'add', '.');
    git(repo.root, 'commit', '-q', '-m', 'forge');
    expect(() => runBaseline(repo.root, 'c1')).toThrow('Staging may not target the JUnit report path');
  });
});
