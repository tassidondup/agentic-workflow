import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { realExec, type Exec, type ExecResult } from '../src/exec.js';
import { runTests } from '../src/run-tests.js';
import { git, makeRepo, type TestRepo } from './helpers/repo.js';

let repo: TestRepo;
afterEach(() => repo?.cleanup());

const REPORT = 'reports/junit.xml';

function setup(test: Record<string, unknown> = {}): void {
  repo = makeRepo({
    'workflow.config.json': JSON.stringify({
      approvers: ['tassi'],
      test: { setup: ['npm', 'ci'], command: ['npx', 'vitest'], junitReport: REPORT, acceptanceDir: 'tests/acceptance', harness: [], ...test },
    }),
  });
}

interface Fake {
  readonly exec: Exec;
  readonly calls: string[];
}

/** Fake Exec: records `cmd args` per call; `replies` maps that string to a result (default status 0). */
function fake(replies: Record<string, Partial<ExecResult>> = {}, onCall: (call: string, cwd: string) => void = () => {}): Fake {
  const calls: string[] = [];
  const exec: Exec = (cmd, args, cwd) => {
    if (cmd === 'git') return realExec(cmd, args, cwd);
    const call = [cmd, ...args].join(' ');
    calls.push(call);
    onCall(call, cwd);
    return { status: 0, stdout: '', stderr: '', ...replies[call] };
  };
  return { exec, calls };
}

describe('runTests', () => {
  it('runs setup then command in order and returns 0', () => {
    setup();
    const f = fake({ 'npm ci': { stdout: 'installed\n' }, 'npx vitest': { stdout: 'ok\n', stderr: 'warn\n' } });
    const r = runTests(repo.root, f.exec);
    expect(f.calls).toEqual(['npm ci', 'npx vitest']);
    expect(r.status).toBe(0);
    expect(r.output).toBe('installed\nok\nwarn\n');
  });

  it('runs only the command when there is no setup', () => {
    setup({ setup: undefined });
    const f = fake();
    expect(runTests(repo.root, f.exec).status).toBe(0);
    expect(f.calls).toEqual(['npx vitest']);
  });

  it('stops at a failing setup and does not run the command', () => {
    setup();
    const f = fake({ 'npm ci': { status: 1, stderr: 'boom\n' } });
    const r = runTests(repo.root, f.exec);
    expect(f.calls).toEqual(['npm ci']);
    expect(r).toEqual({ status: 1, output: 'boom\n' });
  });

  it('returns 1 when the command fails', () => {
    setup();
    const f = fake({ 'npx vitest': { status: 1 } });
    expect(runTests(repo.root, f.exec).status).toBe(1);
  });

  it('runs the commands in the repo root', () => {
    setup();
    const cwds: string[] = [];
    runTests(repo.root, fake({}, (_c, cwd) => cwds.push(cwd)).exec);
    expect(cwds).toEqual([repo.root, repo.root]);
  });

  describe('--report-out', () => {
    /** The test command writes the JUnit report (cwd is the repo root). */
    const writeJunit = (xml: string) => (call: string): void => {
      if (call === 'npx vitest') repo.write(REPORT, xml);
    };

    it('copies the report to --report-out after success', () => {
      setup();
      const r = runTests(repo.root, fake({}, writeJunit('<testsuites/>')).exec, '.wf-report/junit.xml');
      expect(r.status).toBe(0);
      expect(readFileSync(join(repo.root, '.wf-report/junit.xml'), 'utf8')).toBe('<testsuites/>');
    });

    it('fails when the report is missing after a successful run', () => {
      setup();
      expect(() => runTests(repo.root, fake().exec, '.wf-report/junit.xml')).toThrow(/did not write reports\/junit\.xml/);
      expect(existsSync(join(repo.root, '.wf-report/junit.xml'))).toBe(false);
    });

    it('ignores a report that existed before the command ran', () => {
      setup();
      repo.write(REPORT, 'stale');
      expect(() => runTests(repo.root, fake().exec, 'out.xml')).toThrow(/did not write/);
    });

    it('does not copy the report when the command fails', () => {
      setup();
      const f = fake({ 'npx vitest': { status: 1 } }, writeJunit('<testsuites/>'));
      expect(runTests(repo.root, f.exec, 'out.xml').status).toBe(1);
      expect(existsSync(join(repo.root, 'out.xml'))).toBe(false);
    });

    it('rejects an unsafe --report-out before running anything', () => {
      setup();
      const f = fake();
      expect(() => runTests(repo.root, f.exec, '../x')).toThrow();
      expect(() => runTests(repo.root, f.exec, '/tmp/x')).toThrow();
      expect(f.calls).toEqual([]);
    });

    it('refuses to read a symlinked report', () => {
      setup();
      repo.write('secret.txt', 'secret');
      const link = (call: string): void => {
        if (call === 'npx vitest') repo.symlink(join(repo.root, 'secret.txt'), REPORT);
      };
      expect(() => runTests(repo.root, fake({}, link).exec, 'out.xml')).toThrow(/Symlinks are not allowed/);
      expect(existsSync(join(repo.root, 'out.xml'))).toBe(false);
    });
  });

  it('throws on a bad config', () => {
    repo = makeRepo({ 'workflow.config.json': '{}' });
    expect(() => runTests(repo.root, fake().exec)).toThrow(/workflow\.config\.json/);
  });

  describe('--base (test config from the base commit)', () => {
    const cfg = (test: Record<string, unknown>): string =>
      JSON.stringify({ approvers: ['tassi'], test: { command: ['npx', 'vitest'], junitReport: REPORT, acceptanceDir: 'tests/acceptance', harness: [], ...test } });

    /** `main` holds `baseTest`; the checked-out `pr` branch holds `prTest`. */
    function prRepo(baseTest: Record<string, unknown>, prTest: Record<string, unknown> | null): void {
      repo = makeRepo({ 'workflow.config.json': cfg(baseTest) });
      git(repo.root, 'init', '-q', '-b', 'main');
      git(repo.root, 'add', '-A');
      git(repo.root, 'commit', '-qm', 'base');
      if (prTest !== null) {
        git(repo.root, 'checkout', '-qb', 'pr');
        repo.write('workflow.config.json', cfg(prTest));
        git(repo.root, 'commit', '--allow-empty', '-qam', 'pr');
      }
    }

    it('runs the base command when the PR changed it to a fake one', () => {
      prRepo({}, { command: ['true'] });
      const f = fake();
      runTests(repo.root, f.exec, undefined, 'main');
      expect(f.calls).toEqual(['npx vitest']);
    });

    it('runs the base setup and copies the base report path', () => {
      prRepo({ setup: ['npm', 'ci'], junitReport: 'out/base.xml' }, { setup: undefined, junitReport: 'out/pr.xml' });
      const f = fake({}, (call) => {
        if (call === 'npx vitest') repo.write('out/base.xml', '<base/>');
      });
      runTests(repo.root, f.exec, 'copy.xml', 'main');
      expect(f.calls).toEqual(['npm ci', 'npx vitest']);
      expect(readFileSync(join(repo.root, 'copy.xml'), 'utf8')).toBe('<base/>');
    });

    it('says so when the PR changes the test settings, and stays quiet when it does not', () => {
      prRepo({}, { command: ['true'] });
      expect(runTests(repo.root, fake().exec, undefined, 'main').output).toMatch(/^wf: the test settings in workflow\.config\.json differ from main; using main's/);
      prRepo({}, {});
      expect(runTests(repo.root, fake().exec, undefined, 'main').output).toBe('');
    });

    it('throws, running nothing, when the base has no config', () => {
      repo = makeRepo({ 'workflow.config.json': cfg({}) });
      git(repo.root, 'init', '-q', '-b', 'main');
      git(repo.root, 'commit', '--allow-empty', '-qm', 'empty');
      const f = fake();
      expect(() => runTests(repo.root, f.exec, undefined, 'main')).toThrow(/is not on main; the test settings must come from the base branch/);
      expect(f.calls).toEqual([]);
    });

    it('throws, running nothing, when the base config is unusable', () => {
      repo = makeRepo({ 'workflow.config.json': '{}' });
      git(repo.root, 'init', '-q', '-b', 'main');
      git(repo.root, 'add', '-A');
      git(repo.root, 'commit', '-qm', 'bad');
      const f = fake();
      expect(() => runTests(repo.root, f.exec, undefined, 'main')).toThrow(/on main is unusable for the test settings/);
      expect(f.calls).toEqual([]);
    });
  });
});
