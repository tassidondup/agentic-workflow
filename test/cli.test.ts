import { afterEach, describe, expect, it } from 'vitest';
import { run } from '../src/cli.js';
import { makeRepo, type TestRepo } from './helpers/repo.js';

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

  it('runs spec-lint and memory-check', () => {
    repo = makeRepo({ [`${C}/spec-delta.md`]: '| ID | x | Expected |\n|---|---|---|\n| LST-001 | 1 | 2 |\n| LST-001 | 1 | 2 |' });
    const l = cli('spec-lint', 'c1');
    expect(l.code).toBe(1);
    expect(l.out).toMatch(/spec-delta\.md:4 Row ID LST-001 appears more than once/);
    expect(cli('memory-check').code).toBe(1);
  });

  it('promotes and stage-checks', () => {
    repo = makeRepo({ [`${C}/tests/stage/tests/acceptance/a.test.ts`]: 't' });
    expect(cli('stage-check', 'c1').code).toBe(1);
    expect(cli('promote', 'c1', 'tests').out).toMatch(/tests\/acceptance\/a\.test\.ts/);
    expect(cli('stage-check', 'c1').code).toBe(0);
  });

  it('trace-checks a JUnit report', () => {
    repo = makeRepo({
      [`${C}/spec-delta.md`]: '| ID | x | Expected |\n|---|---|---|\n| LST-001 | 1 | 2 |',
      'reports/junit.xml': '<testsuite name="s"><testcase classname="c" name="[LST-001] ok"/></testsuite>',
    });
    expect(cli('trace-check', 'c1', '--report', 'reports/junit.xml').code).toBe(0);
    repo.write('reports/junit.xml', '<testsuite name="s"><testcase classname="c" name="[LST-001] ok"><failure/></testcase></testsuite>');
    const t = cli('trace-check', 'c1', '--report', 'reports/junit.xml');
    expect(t.code).toBe(1);
    expect(t.out).toMatch(/LST-001: failing/);
  });
});
