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
      const r = runTests(repo.root, fake({}, writeJunit('<testsuites/>')).exec, { reportOut: '.wf-report/junit.xml' });
      expect(r.status).toBe(0);
      expect(readFileSync(join(repo.root, '.wf-report/junit.xml'), 'utf8')).toBe('<testsuites/>');
    });

    it('fails when the report is missing after a successful run', () => {
      setup();
      expect(() => runTests(repo.root, fake().exec, { reportOut: '.wf-report/junit.xml' })).toThrow(/did not write reports\/junit\.xml/);
      expect(existsSync(join(repo.root, '.wf-report/junit.xml'))).toBe(false);
    });

    it('ignores a report that existed before the command ran', () => {
      setup();
      repo.write(REPORT, 'stale');
      expect(() => runTests(repo.root, fake().exec, { reportOut: 'out.xml' })).toThrow(/did not write/);
    });

    it('does not copy the report when the command fails', () => {
      setup();
      const f = fake({ 'npx vitest': { status: 1 } }, writeJunit('<testsuites/>'));
      expect(runTests(repo.root, f.exec, { reportOut: 'out.xml' }).status).toBe(1);
      expect(existsSync(join(repo.root, 'out.xml'))).toBe(false);
    });

    it('rejects an unsafe --report-out before running anything', () => {
      setup();
      const f = fake();
      expect(() => runTests(repo.root, f.exec, { reportOut: '../x' })).toThrow();
      expect(() => runTests(repo.root, f.exec, { reportOut: '/tmp/x' })).toThrow();
      expect(f.calls).toEqual([]);
    });

    it('refuses to read a symlinked report', () => {
      setup();
      repo.write('secret.txt', 'secret');
      const link = (call: string): void => {
        if (call === 'npx vitest') repo.symlink(join(repo.root, 'secret.txt'), REPORT);
      };
      expect(() => runTests(repo.root, fake({}, link).exec, { reportOut: 'out.xml' })).toThrow(/Symlinks are not allowed/);
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
      runTests(repo.root, f.exec, { base: 'main' });
      expect(f.calls).toEqual(['npx vitest']);
    });

    it('runs the base setup and copies the base report path', () => {
      prRepo({ setup: ['npm', 'ci'], junitReport: 'out/base.xml' }, { setup: undefined, junitReport: 'out/pr.xml' });
      const f = fake({}, (call) => {
        if (call === 'npx vitest') repo.write('out/base.xml', '<base/>');
      });
      runTests(repo.root, f.exec, { reportOut: 'copy.xml', base: 'main' });
      expect(f.calls).toEqual(['npm ci', 'npx vitest']);
      expect(readFileSync(join(repo.root, 'copy.xml'), 'utf8')).toBe('<base/>');
    });

    it('says so when the PR changes the test settings, and stays quiet when it does not', () => {
      prRepo({}, { command: ['true'] });
      expect(runTests(repo.root, fake().exec, { base: 'main' }).output).toMatch(/^wf: the test settings in workflow\.config\.json differ from main; using main's/);
      prRepo({}, {});
      expect(runTests(repo.root, fake().exec, { base: 'main' }).output).toBe('');
    });

    it('throws, running nothing, when the base has no config', () => {
      repo = makeRepo({ 'workflow.config.json': cfg({}) });
      git(repo.root, 'init', '-q', '-b', 'main');
      git(repo.root, 'commit', '--allow-empty', '-qm', 'empty');
      const f = fake();
      expect(() => runTests(repo.root, f.exec, { base: 'main' })).toThrow(/is not on main; the test settings must come from the base branch/);
      expect(f.calls).toEqual([]);
    });

    it('throws, running nothing, when the base config is unusable', () => {
      repo = makeRepo({ 'workflow.config.json': '{}' });
      git(repo.root, 'init', '-q', '-b', 'main');
      git(repo.root, 'add', '-A');
      git(repo.root, 'commit', '-qm', 'bad');
      const f = fake();
      expect(() => runTests(repo.root, f.exec, { base: 'main' })).toThrow(/on main is unusable for the test settings/);
      expect(f.calls).toEqual([]);
    });
  });
});

describe('runTests: isolated, with a canary', () => {
  const NONCE = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
  const CANARY_PATH = 'tests/acceptance/canary.test.ts';
  const TEMPLATE = "it('[canary:__WF_CANARY_NONCE__]', () => {});\n";
  const IMAGE = 'node:24';

  function isolatedRepo(patch: Record<string, unknown> = {}): void {
    repo = makeRepo({
      'workflow.config.json': JSON.stringify({
        approvers: ['tassi'],
        test: {
          setup: ['npm', 'ci'],
          command: ['npx', 'vitest'],
          junitReport: REPORT,
          acceptanceDir: 'tests/acceptance',
          harness: ['tests/harness'],
          image: IMAGE,
          canary: { template: 'tests/harness/canary.template.ts', path: CANARY_PATH },
          ...patch,
        },
      }),
      'tests/harness/canary.template.ts': TEMPLATE,
    });
  }

  const xml = (cases: Array<[string, string, 'passed' | 'failed']>): string =>
    `<testsuites><testsuite name="s">${cases
      .map(([name, file, st]) => `<testcase name="${name}" classname="${file}" file="${file}">${st === 'failed' ? '<failure message="x"/>' : ''}</testcase>`)
      .join('')}</testsuite></testsuites>`;
  const canaryCase = (st: 'passed' | 'failed'): [string, string, 'passed' | 'failed'] => [`[canary:${NONCE}]`, CANARY_PATH, st];
  const other = (st: 'passed' | 'failed'): [string, string, 'passed' | 'failed'] => ['[LST-001] works', 'tests/acceptance/a.test.ts', st];

  interface Step {
    readonly argv: readonly string[];
    readonly network: string;
  }
  interface DockerFake {
    readonly exec: Exec;
    readonly steps: Step[];
    readonly hostCalls: string[];
  }
  /** Fake docker: records each step; `onStep` plays the container (it may write the report) and returns the exit status. */
  function dockerFake(onStep: (step: Step) => number = () => 0): DockerFake {
    const steps: Step[] = [];
    const hostCalls: string[] = [];
    const exec: Exec = (cmd, args, cwd) => {
      if (cmd === 'git') return realExec(cmd, args, cwd);
      if (cmd !== 'docker') {
        hostCalls.push([cmd, ...args].join(' '));
        return { status: 0, stdout: '', stderr: '' };
      }
      const step = { argv: args.slice(args.indexOf(IMAGE) + 1), network: args[args.indexOf('--network') + 1] ?? '' };
      steps.push(step);
      return { status: onStep(step), stdout: '', stderr: '' };
    };
    return { exec, steps, hostCalls };
  }
  const isCommand = (s: Step): boolean => s.argv[0] === 'npx';
  const writeReport = (cases: Array<[string, string, 'passed' | 'failed']>, status = 1) => (s: Step): number => {
    if (isCommand(s)) repo.write(REPORT, xml(cases));
    return isCommand(s) ? status : 0;
  };
  const opts = { isolate: true, canary: NONCE, reportOut: 'out/junit.xml' };

  it('runs setup with the network and the command without it, nothing on the host', () => {
    isolatedRepo();
    const f = dockerFake(writeReport([canaryCase('failed'), other('passed')]));
    runTests(repo.root, f.exec, opts);
    expect(f.steps).toEqual([
      { argv: ['npm', 'ci'], network: 'bridge' },
      { argv: ['npx', 'vitest'], network: 'none' },
    ]);
    expect(f.hostCalls).toEqual([]);
  });

  it('succeeds when only the canary fails, copies the report and removes the canary file', () => {
    isolatedRepo();
    const f = dockerFake((s) => {
      if (isCommand(s)) expect(readFileSync(join(repo.root, CANARY_PATH), 'utf8')).toBe(TEMPLATE.replace('__WF_CANARY_NONCE__', NONCE));
      return writeReport([canaryCase('failed'), other('passed')])(s);
    });
    const r = runTests(repo.root, f.exec, opts);
    expect(r.status).toBe(0);
    expect(r.output).toMatch(/canary failed as expected/);
    expect(readFileSync(join(repo.root, 'out/junit.xml'), 'utf8')).toBe(xml([canaryCase('failed'), other('passed')]));
    expect(existsSync(join(repo.root, CANARY_PATH))).toBe(false);
  });

  it('fails when a real test fails besides the canary, and copies nothing', () => {
    isolatedRepo();
    const r = runTests(repo.root, dockerFake(writeReport([canaryCase('failed'), other('failed')])).exec, opts);
    expect(r.status).toBe(1);
    expect(existsSync(join(repo.root, 'out/junit.xml'))).toBe(false);
  });

  it.each([
    ['the canary passed (assertions disabled)', [canaryCase('passed'), other('passed')], 0],
    ['the canary is missing (file filtered)', [other('passed')], 0],
    ['the canary is missing and the runner says it failed', [other('passed')], 1],
  ])('fails when %s', (_label, cases, exit) => {
    isolatedRepo();
    const r = runTests(repo.root, dockerFake(writeReport(cases, exit)).exec, opts);
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/cannot be trusted/);
    expect(existsSync(join(repo.root, 'out/junit.xml'))).toBe(false);
    expect(existsSync(join(repo.root, CANARY_PATH))).toBe(false);
  });

  it.each([
    ['a suite that declares an error no test lists', '<testsuites><testsuite name="a.test.ts" failures="0" errors="1"><testcase name="[LST-001] works" classname="tests/acceptance/a.test.ts"/></testsuite></testsuites>'],
    ['an error outside any test', '<testsuites><testsuite name="a.test.ts"><testcase name="[LST-001] works" classname="tests/acceptance/a.test.ts"/><error message="Cannot find module"/></testsuite></testsuites>'],
  ])('fails when the report has %s, though only the canary case failed', (_label, extra) => {
    isolatedRepo();
    const canary = `<testsuite name="canary" failures="1"><testcase name="[canary:${NONCE}]" classname="${CANARY_PATH}" file="${CANARY_PATH}"><failure message="x"/></testcase></testsuite>`;
    const report = extra.replace('<testsuites>', `<testsuites>${canary}`);
    const r = runTests(repo.root, dockerFake((s) => { if (isCommand(s)) repo.write(REPORT, report); return isCommand(s) ? 1 : 0; }).exec, opts);
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/a\.test\.ts/);
    expect(existsSync(join(repo.root, 'out/junit.xml'))).toBe(false);
  });

  it('fails when the runner exits 0 although the report shows the canary failing', () => {
    isolatedRepo();
    const r = runTests(repo.root, dockerFake(writeReport([canaryCase('failed'), other('passed')], 0)).exec, opts);
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/exited 0 although the canary failed/);
  });

  it('returns the command status when it left no report at all', () => {
    isolatedRepo();
    const r = runTests(repo.root, dockerFake((s) => (isCommand(s) ? 7 : 0)).exec, opts);
    expect(r.status).toBe(7);
  });

  it('removes the canary file even when reading the report throws', () => {
    isolatedRepo();
    const f = dockerFake((s) => {
      if (isCommand(s)) repo.write(REPORT, 'not xml');
      return isCommand(s) ? 1 : 0;
    });
    expect(() => runTests(repo.root, f.exec, opts)).toThrow(/Invalid JUnit XML/);
    expect(existsSync(join(repo.root, CANARY_PATH))).toBe(false);
  });

  it('refuses --isolate without test.image, before running anything', () => {
    isolatedRepo({ image: undefined });
    const f = dockerFake();
    expect(() => runTests(repo.root, f.exec, { isolate: true })).toThrow(/test\.image/);
    expect(f.steps).toEqual([]);
  });

  it('refuses --canary without test.canary, and a malformed nonce', () => {
    isolatedRepo({ canary: undefined });
    const f = dockerFake();
    expect(() => runTests(repo.root, f.exec, { isolate: true, canary: NONCE })).toThrow(/test\.canary/);
    isolatedRepo();
    expect(() => runTests(repo.root, f.exec, { isolate: true, canary: 'nope' })).toThrow(/nonce/);
    expect(f.steps).toEqual([]);
  });

  it('also works without --isolate: setup and command run on the host', () => {
    isolatedRepo();
    const f = dockerFake();
    expect(() => runTests(repo.root, f.exec, { canary: NONCE })).toThrow(/did not write/);
    expect(f.steps).toEqual([]);
    expect(f.hostCalls).toEqual(['npm ci', 'npx vitest']);
    expect(existsSync(join(repo.root, CANARY_PATH))).toBe(false);
  });
});
