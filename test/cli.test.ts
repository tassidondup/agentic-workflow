import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/cli.js';
import { realExec, type Exec, type ExecResult } from '../src/exec.js';
import { approveAll, changeFiles } from './helpers/change.js';
import { git, makeRepo, type TestRepo } from './helpers/repo.js';

let repo: TestRepo;
afterEach(() => repo?.cleanup());
const C = 'docs/changes/c1';

function cli(...argv: string[]): { code: number; out: string; err: string } {
  const out: string[] = [];
  const err: string[] = [];
  const code = run(argv, { out: (s) => out.push(s), err: (s) => err.push(s), cwd: repo.root });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

describe('wf cli', () => {
  it('prints usage for --help with exit 0 and for unknown commands with exit 2', () => {
    repo = makeRepo();
    expect(cli('--help').code).toBe(0);
    const r = cli('frobnicate');
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/Usage: wf/);
  });

  it('approves a gate and reports it valid', () => {
    repo = makeRepo({ [`${C}/proposal.md`]: 'p', [`${C}/spec-delta.md`]: 's', [`${C}/change.json`]: '{"level":"P1","noBehaviourChange":false}' });
    const a = cli('approve', 'c1', 'spec');
    expect(a.code).toBe(0);
    expect(a.out).toMatch(/approvals\/spec\.json/);
    expect(a.out).toMatch(/only counts once your account merges/);
    const g = cli('gate-check', 'c1', 'spec');
    expect(g.code).toBe(0);
    expect(g.out).toMatch(/spec\s+valid/);
  });

  it('exits 1 with problems when a gate is not valid', () => {
    repo = makeRepo();
    const g = cli('gate-check', 'c1');
    expect(g.code).toBe(1);
    expect(g.out).toMatch(/spec\s+missing/);
  });

  it('exits 2 with a message on invalid input instead of crashing', () => {
    repo = makeRepo();
    expect(cli('approve', 'Bad_ID', 'spec')).toMatchObject({ code: 2 });
    expect(cli('approve', 'c1', 'nonsense').err).toMatch(/gate must be one of spec, design, tests/);
    expect(cli('promote', 'c1', 'spec').err).toMatch(/promote takes design or tests/);
    expect(cli('trace-check', 'c1').err).toMatch(/--report/);
  });

  it('rejects extra positional arguments', () => {
    repo = makeRepo();
    const a = cli('approve', 'c1', 'spec', 'design');
    expect(a.code).toBe(2);
    expect(a.err).toMatch(/at most 2/);
    expect(cli('memory-check', 'extra').code).toBe(2);
  });

  it('rejects --report on commands other than trace-check', () => {
    repo = makeRepo();
    const g = cli('gate-check', 'c1', '--report', 'r.xml');
    expect(g.code).toBe(2);
    expect(g.err).toMatch(/--report is only for trace-check/);
  });

  it('runs spec-lint and memory-check', () => {
    repo = makeRepo({ [`${C}/spec-delta.md`]: '| ID | x | Expected |\n|---|---|---|\n| LST-001 | 1 | 2 |\n| LST-001 | 1 | 2 |' });
    const l = cli('spec-lint', 'c1');
    expect(l.code).toBe(1);
    expect(l.out).toMatch(/spec-delta\.md:4 Row ID LST-001 appears more than once/);
    expect(cli('memory-check').code).toBe(1);
  });

  it('promotes and stage-checks; stage-check needs the gate approved (I3)', () => {
    repo = makeRepo(changeFiles());
    expect(cli('stage-check', 'c1').code).toBe(1);
    expect(cli('promote', 'c1', 'tests').out).toMatch(/tests\/acceptance\/a\.test\.ts/);
    const unapproved = cli('stage-check', 'c1');
    expect(unapproved.code).toBe(1);
    expect(unapproved.out).toMatch(/tests gate is missing/);
    approveAll(repo);
    expect(cli('stage-check', 'c1').code).toBe(0);
    expect(cli('stage-check', 'c9').code).toBe(2);
  });

  it('trace-checks a JUnit report once the tests gate is valid (I3)', () => {
    repo = makeRepo({
      ...changeFiles(),
      'reports/junit.xml': '<testsuite name="s"><testcase classname="tests/acceptance/a.test.ts" name="[LST-001] ok"/></testsuite>',
    });
    const unapproved = cli('trace-check', 'c1', '--report', 'reports/junit.xml');
    expect(unapproved.code).toBe(1);
    expect(unapproved.out).toMatch(/tests gate is missing; retirements and rows are not approved/);
    approveAll(repo);
    expect(cli('trace-check', 'c1', '--report', 'reports/junit.xml').code).toBe(0);
    repo.write('reports/junit.xml', '<testsuite name="s"><testcase classname="tests/acceptance/a.test.ts" name="[LST-001] ok"><failure/></testcase></testsuite>');
    const t = cli('trace-check', 'c1', '--report', 'reports/junit.xml');
    expect(t.code).toBe(1);
    expect(t.out).toMatch(/LST-001: failing/);
    const missing = cli('trace-check', 'c9', '--report', 'reports/junit.xml');
    expect(missing.code).toBe(2);
    expect(missing.err).toMatch(/Change c9 not found/);
  });

  it('refuses to approve when docs/changes is a symlink and writes nothing outside (C1/I1)', () => {
    const outside = mkdtempSync(join(tmpdir(), 'wf-outside-'));
    try {
      mkdirSync(join(outside, 'c1'));
      writeFileSync(join(outside, 'c1', 'proposal.md'), 'p');
      writeFileSync(join(outside, 'c1', 'spec-delta.md'), 's');
      writeFileSync(join(outside, 'c1', 'change.json'), '{"level":"P1","noBehaviourChange":false}');
      repo = makeRepo();
      mkdirSync(join(repo.root, 'docs'));
      symlinkSync(outside, join(repo.root, 'docs', 'changes'));
      const a = cli('approve', 'c1', 'spec');
      expect(a.code).toBe(2);
      expect(a.err).toMatch(/Symlinks are not allowed: docs\/changes/);
      expect(readdirSync(join(outside, 'c1')).sort()).toEqual(['change.json', 'proposal.md', 'spec-delta.md']);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('refuses a --report path that goes through a symlink', () => {
    repo = makeRepo({ [`${C}/spec-delta.md`]: '| ID | x | Expected |\n|---|---|---|\n| LST-001 | 1 | 2 |' });
    repo.symlink('/etc', 'reports');
    const t = cli('trace-check', 'c1', '--report', 'reports/hosts');
    expect(t.code).toBe(2);
    expect(t.err).toMatch(/Symlinks are not allowed: reports/);
  });

  describe('classify and pr-check', () => {
    /** A git repo with main committed, then a branch that adds `files`. */
    function branchWith(branch: string, files: Record<string, string>): void {
      repo?.cleanup();
      repo = makeRepo({ 'README.md': 'hi', 'workflow.config.json': JSON.stringify({ ...(JSON.parse(CFG_BASE) as object), exempt: ['README.md'] }) });
      git(repo.root, 'init', '-b', 'main');
      git(repo.root, 'add', '-A');
      git(repo.root, 'commit', '-m', 'init');
      git(repo.root, 'checkout', '-b', branch);
      Object.entries(files).forEach(([p, c]) => repo.write(p, c));
      git(repo.root, 'add', '-A');
      git(repo.root, 'commit', '-m', 'work');
    }
    const CFG_BASE = JSON.stringify({ approvers: ['tassi'], test: { command: ['t'], junitReport: 'reports/junit.xml', acceptanceDir: 'tests/acceptance', harness: [] } });
    const strayGate = { [`${C}/approvals/spec.json`]: '{}', 'stray.txt': 'x' };

    it('classify prints only key=value lines on stdout and problems on stderr', () => {
      branchWith('change/c1', { 'src/a.ts': 'x' });
      const ok = cli('classify', '--base', 'main', '--branch', 'change/c1');
      expect(ok).toEqual({ code: 0, out: 'kind=change\nchange=c1', err: '' });
      branchWith('gate/c1-spec', strayGate);
      const bad = cli('classify', '--base', 'main', '--branch', 'gate/c1-spec');
      expect(bad.code).toBe(1);
      expect(bad.out).toBe('');
      expect(bad.err).toBe('- stray.txt is outside docs/changes/c1/');
    });

    it('classify prints the gate for a gate PR', () => {
      branchWith('gate/c1-spec', { [`${C}/approvals/spec.json`]: '{}' });
      expect(cli('classify', '--base', 'main', '--branch', 'gate/c1-spec').out).toBe('kind=gate\nchange=c1\ngate=spec');
    });

    it('classify exits 2 without --branch or --base', () => {
      branchWith('change/c1', { 'src/a.ts': 'x' });
      const noBranch = cli('classify', '--base', 'main');
      expect(noBranch.code).toBe(2);
      expect(noBranch.err).toMatch(/--branch/);
      expect(noBranch.out).toBe('');
      expect(cli('classify', '--branch', 'change/c1').err).toMatch(/--base/);
    });

    it('--base with an option-like value exits 2', () => {
      branchWith('change/c1', { 'src/a.ts': 'x' });
      const attached = cli('classify', '--base=--output=/tmp/x', '--branch', 'change/c1');
      expect(attached.code).toBe(2);
      expect(attached.err).toMatch(/Unsafe git ref/);
      expect(cli('classify', '--base', '--output=/tmp/x', '--branch', 'change/c1').code).toBe(2);
    });

    it('a flag on a command that does not take it exits 2', () => {
      repo = makeRepo();
      const repoFlag = cli('spec-lint', 'c1', '--repo', 'a/b');
      expect(repoFlag.code).toBe(2);
      expect(repoFlag.err).toMatch(/--repo is only for pr-check/);
      expect(cli('classify', '--base', 'main', '--branch', 'b', '--repo', 'a/b').code).toBe(2);
      expect(cli('classify', '--base', 'main', '--branch', 'b', '--base-branch', 'main').code).toBe(2);
      expect(cli('pr-check', '--report', 'r.xml').err).toMatch(/--report is only for trace-check/);
    });

    it('pr-check exits 2 naming a missing flag', () => {
      branchWith('change/c1', { 'src/a.ts': 'x' });
      const r = cli('pr-check', '--base', 'main', '--base-branch', 'main', '--branch', 'change/c1');
      expect(r.code).toBe(2);
      expect(r.err).toMatch(/--repo/);
    });

    it('pr-check exits 1 and prints problems', () => {
      branchWith('gate/c1-spec', strayGate);
      const r = cli('pr-check', '--base', 'main', '--base-branch', 'main', '--branch', 'gate/c1-spec', '--repo', 'acme/app');
      expect(r.code).toBe(1);
      expect(r.out).toBe('- stray.txt is outside docs/changes/c1/');
    });

    it('escapes control characters in problem lines so a file name cannot forge a log line', () => {
      branchWith('gate/c1-spec', { [`${C}/approvals/spec.json`]: '{}', 'x\n::error::boom': 'x' });
      const c = cli('classify', '--base', 'main', '--branch', 'gate/c1-spec');
      expect(c.err).toBe('- x\\u000a::error::boom is outside docs/changes/c1/');
      const p = cli('pr-check', '--base', 'main', '--base-branch', 'main', '--branch', 'gate/c1-spec', '--repo', 'acme/app');
      expect(p.out).toBe('- x\\u000a::error::boom is outside docs/changes/c1/');
    });

    it('a git failure is a failed check (exit 1), not a usage error', () => {
      branchWith('change/c1', { 'src/a.ts': 'x' });
      const p = cli('pr-check', '--base', 'nosuchref', '--base-branch', 'main', '--branch', 'change/c1', '--repo', 'acme/app');
      expect(p.code).toBe(1);
      expect(p.out).toMatch(/^- git diff failed/);
      const c = cli('classify', '--base', 'nosuchref', '--branch', 'change/c1');
      expect(c).toMatchObject({ code: 1, out: '' });
      expect(c.err).toMatch(/^- git diff failed/);
    });

    it('pr-check exits 0 for a PR that only touches exempt paths', () => {
      branchWith('docs-fix', { 'README.md': 'changed' });
      const r = cli('pr-check', '--base', 'main', '--base-branch', 'main', '--branch', 'docs-fix', '--repo', 'acme/app');
      expect(r).toEqual({ code: 0, out: 'kind=exempt', err: '' });
    });

    it('classify and pr-check exit 1 for source changes on an ordinary branch, with the path escaped', () => {
      branchWith('feat/sneaky', { 'src/a\nb.ts': 'x' });
      const line = '- src/a\\u000ab.ts is not exempt, and this PR is neither a gate PR nor on a change/<id> branch';
      const c = cli('classify', '--base', 'main', '--branch', 'feat/sneaky');
      expect(c).toEqual({ code: 1, out: '', err: line });
      const p = cli('pr-check', '--base', 'main', '--base-branch', 'main', '--branch', 'feat/sneaky', '--repo', 'acme/app');
      expect(p).toEqual({ code: 1, out: line, err: '' });
    });

    it('a base without workflow.config.json is a failed check for such a PR, not a usage error', () => {
      repo?.cleanup();
      repo = makeRepo({ 'README.md': 'hi' });
      git(repo.root, 'init', '-b', 'main');
      git(repo.root, 'add', '-A');
      git(repo.root, 'commit', '-m', 'init');
      git(repo.root, 'checkout', '-b', 'docs-fix');
      repo.write('README.md', 'changed');
      git(repo.root, 'commit', '-qam', 'work');
      const c = cli('classify', '--base', 'main', '--branch', 'docs-fix');
      expect(c).toMatchObject({ code: 1, out: '' });
      expect(c.err).toMatch(/exempt paths must come from the base branch/);
    });
  });

  describe('run-tests', () => {
    const CFG = JSON.stringify({
      approvers: ['tassi'],
      test: { command: ['t'], junitReport: 'reports/junit.xml', acceptanceDir: 'tests/acceptance', harness: [] },
    });
    function cliExec(reply: Partial<ExecResult>, argv: string[], onRun: () => void = () => {}): { code: number; out: string; err: string } {
      const exec: Exec = () => {
        onRun();
        return { status: 0, stdout: '', stderr: '', ...reply };
      };
      const out: string[] = [];
      const err: string[] = [];
      const code = run(argv, { out: (s) => out.push(s), err: (s) => err.push(s), cwd: repo.root, exec });
      return { code, out: out.join('\n'), err: err.join('\n') };
    }

    it('prints the runner output and exits 0 on success', () => {
      repo = makeRepo({ 'workflow.config.json': CFG });
      expect(cliExec({ stdout: '3 passed\n' }, ['run-tests'])).toEqual({ code: 0, out: '3 passed', err: '' });
    });

    it('exits 1 for any non-zero status and still prints the output', () => {
      repo = makeRepo({ 'workflow.config.json': CFG });
      const r = cliExec({ status: 7, stdout: 'FAIL\n' }, ['run-tests']);
      expect(r).toMatchObject({ code: 1, out: 'FAIL' });
    });

    it('accepts --report-out and copies the report', () => {
      repo = makeRepo({ 'workflow.config.json': CFG });
      const r = cliExec({}, ['run-tests', '--report-out', '.wf-report/junit.xml'], () => repo.write('reports/junit.xml', '<x/>'));
      expect(r.code).toBe(0);
      expect(readFileSync(join(repo.root, '.wf-report/junit.xml'), 'utf8')).toBe('<x/>');
    });

    it('exits 2 when the report is missing', () => {
      repo = makeRepo({ 'workflow.config.json': CFG });
      const r = cliExec({}, ['run-tests', '--report-out', 'out.xml']);
      expect(r.code).toBe(2);
      expect(r.err).toMatch(/did not write reports\/junit\.xml/);
    });

    it('exits 2 for an unsafe --report-out without running the tests', () => {
      repo = makeRepo({ 'workflow.config.json': CFG });
      let ran = false;
      const r = cliExec({}, ['run-tests', '--report-out', '../x'], () => { ran = true; });
      expect(r.code).toBe(2);
      expect(r.err).toMatch(/--report-out/);
      expect(ran).toBe(false);
    });

    it('exits 2 on a bad config', () => {
      repo = makeRepo({ 'workflow.config.json': '{}' });
      expect(cliExec({}, ['run-tests']).code).toBe(2);
    });

    it('--base reads the test settings from that commit, not the working tree', () => {
      const cfg = (command: string[]): string =>
        JSON.stringify({ approvers: ['tassi'], test: { command, junitReport: 'reports/junit.xml', acceptanceDir: 'tests/acceptance', harness: [] } });
      repo = makeRepo({ 'workflow.config.json': cfg(['real-tests']) });
      git(repo.root, 'init', '-q', '-b', 'main');
      git(repo.root, 'add', '-A');
      git(repo.root, 'commit', '-qm', 'base');
      git(repo.root, 'checkout', '-qb', 'pr');
      repo.write('workflow.config.json', cfg(['fake-tests']));
      git(repo.root, 'commit', '-qam', 'pr');
      const ran: string[] = [];
      const exec: Exec = (cmd, args, cwd) => {
        if (cmd === 'git') return realExec(cmd, args, cwd);
        ran.push(cmd);
        return { status: 0, stdout: '', stderr: '' };
      };
      const out: string[] = [];
      const code = run(['run-tests', '--base', 'main'], { out: (s) => out.push(s), err: () => {}, cwd: repo.root, exec });
      expect(code).toBe(0);
      expect(ran).toEqual(['real-tests']);
      expect(out.join('\n')).toMatch(/differ from main; using main's/);
    });

    it('--base with no config on that commit exits 2 and runs nothing', () => {
      repo = makeRepo({ 'workflow.config.json': CFG });
      git(repo.root, 'init', '-q', '-b', 'main');
      git(repo.root, 'commit', '--allow-empty', '-qm', 'empty');
      const ran: string[] = [];
      const exec: Exec = (cmd, args, cwd) => {
        if (cmd === 'git') return realExec(cmd, args, cwd);
        ran.push(cmd);
        return { status: 0, stdout: '', stderr: '' };
      };
      const err: string[] = [];
      const code = run(['run-tests', '--base', 'main'], { out: () => {}, err: (s) => err.push(s), cwd: repo.root, exec });
      expect(code).toBe(2);
      expect(err.join('\n')).toMatch(/is not on main; the test settings must come from the base branch/);
      expect(ran).toEqual([]);
    });

    it('--base on another command that does not take it still exits 2', () => {
      repo = makeRepo();
      expect(cli('spec-lint', 'c1', '--base', 'main').err).toMatch(/--base is only for classify and pr-check and run-tests/);
    });

    it('--isolate and --canary belong to run-tests; a bad nonce or a missing image exits 2 without running anything', () => {
      repo = makeRepo({ 'workflow.config.json': CFG });
      expect(cli('spec-lint', 'c1', '--isolate').err).toMatch(/--isolate is only for run-tests/);
      expect(cli('spec-lint', 'c1', '--canary', 'abcdef0123456789').err).toMatch(/--canary is only for run-tests/);
      let ran = false;
      const bad = cliExec({}, ['run-tests', '--canary', 'NOPE'], () => { ran = true; });
      expect(bad.code).toBe(2);
      expect(bad.err).toMatch(/--canary must be 16 to 64 lowercase hex/);
      const noImage = cliExec({}, ['run-tests', '--isolate'], () => { ran = true; });
      expect(noImage.code).toBe(2);
      expect(noImage.err).toMatch(/test\.image is not set/);
      expect(ran).toBe(false);
    });

    it('--report-out on another command exits 2; run-tests takes no positionals', () => {
      repo = makeRepo();
      const r = cli('spec-lint', 'c1', '--report-out', 'x.xml');
      expect(r.code).toBe(2);
      expect(r.err).toMatch(/--report-out is only for run-tests/);
      expect(cli('run-tests', 'extra').code).toBe(2);
      expect(cli('run-tests', '--report', 'r.xml').err).toMatch(/--report is only for trace-check/);
    });
  });
});
