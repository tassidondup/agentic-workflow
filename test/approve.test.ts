import { afterEach, describe, expect, it } from 'vitest';
import { approve } from '../src/approve.js';
import { baselineInputs } from '../src/baseline-file.js';
import { checkGate } from '../src/gate-check.js';
import { changeFiles } from './helpers/change.js';
import { makeRepo, type TestRepo } from './helpers/repo.js';

let repo: TestRepo;
afterEach(() => repo?.cleanup());
const C = 'docs/changes/c1';
const files = {
  [`${C}/proposal.md`]: 'p',
  [`${C}/spec-delta.md`]: 's',
  [`${C}/change.json`]: '{"level":"P1","noBehaviourChange":false}',
  [`${C}/design/design.md`]: 'd',
};

describe('approve', () => {
  it('approves the spec gate and writes the record', () => {
    repo = makeRepo(files);
    const { path } = approve(repo.root, 'c1', 'spec');
    expect(path).toMatch(/approvals\/spec\.json$/);
    expect(checkGate(repo.root, 'c1', 'spec').status).toBe('valid');
  });

  it('refuses to approve design while spec is missing', () => {
    repo = makeRepo(files);
    expect(() => approve(repo.root, 'c1', 'design')).toThrow(/Cannot approve design: the spec gate is missing/);
  });

  it('refuses to approve design while spec has changed since approval', () => {
    repo = makeRepo(files);
    approve(repo.root, 'c1', 'spec');
    repo.write(`${C}/proposal.md`, 'p2');
    expect(() => approve(repo.root, 'c1', 'design')).toThrow(/the spec gate is changed/);
  });

  it('re-approving a stale downstream gate makes it valid', () => {
    repo = makeRepo(files);
    approve(repo.root, 'c1', 'spec');
    approve(repo.root, 'c1', 'design');
    repo.write(`${C}/spec-delta.md`, 's2');
    approve(repo.root, 'c1', 'spec');
    expect(checkGate(repo.root, 'c1', 'design').status).toBe('stale');
    approve(repo.root, 'c1', 'design');
    expect(checkGate(repo.root, 'c1', 'design').status).toBe('valid');
  });
});

describe('approve tests validates baseline.json (I7)', () => {
  const ready = (extra: Record<string, string> = {}): void => {
    repo = makeRepo(changeFiles('c1', extra));
    approve(repo.root, 'c1', 'spec');
    approve(repo.root, 'c1', 'design');
  };
  const writeBaseline = (patch: Record<string, unknown> = {}): void => {
    const body = { change: 'c1', rows: { 'LST-001': 'fails' }, flags: [], inputs_sha256: baselineInputs(repo.root, 'c1'), ...patch };
    repo.write(`${C}/baseline.json`, JSON.stringify(body));
  };
  const stale = /baseline\.json is stale or invalid: .*; re-run wf baseline/;

  it('approves a baseline that matches the current inputs', () => {
    ready();
    writeBaseline();
    approve(repo.root, 'c1', 'tests');
    expect(checkGate(repo.root, 'c1', 'tests').status).toBe('valid');
  });

  it.each([
    ['not JSON', null, '{oops'],
    ['wrong change', { change: 'c2' }, null],
    ['missing row', { rows: {} }, null],
    ['extra row', { rows: { 'LST-001': 'fails', 'LST-002': 'fails' } }, null],
    ['bad value', { rows: { 'LST-001': 'maybe' } }, null],
    ['nothing fails', { rows: { 'LST-001': 'passes' } }, null],
    ['bad flags', { flags: [1] }, null],
    ['wrong inputs hash', { inputs_sha256: 'b'.repeat(64) }, null],
  ])('refuses %s', (_name, patch, raw) => {
    ready();
    if (raw === null) writeBaseline(patch ?? {});
    else repo.write(`${C}/baseline.json`, raw);
    expect(() => approve(repo.root, 'c1', 'tests')).toThrow(stale);
    expect(checkGate(repo.root, 'c1', 'tests').status).toBe('missing');
  });

  it('refuses a baseline taken before the test configuration changed', () => {
    const config = (command: string[]): string =>
      JSON.stringify({ approvers: ['tassi'], test: { command, junitReport: 'reports/junit.xml' } });
    ready({ 'workflow.config.json': config(['npx', 'vitest', 'run']) });
    writeBaseline();
    repo.write('workflow.config.json', config(['npx', 'vitest', 'run', 'tests/unit']));
    expect(() => approve(repo.root, 'c1', 'tests')).toThrow(stale);
  });

  it('refuses a single row key that fuses two row IDs', () => {
    const delta = '| ID | x | Expected |\n|---|---|---|\n| LST-001 | 1 | 2 |\n| LST-002 | 3 | 4 |\n';
    ready({ [`${C}/spec-delta.md`]: delta });
    writeBaseline({ rows: { 'LST-001,LST-002': 'fails' } });
    expect(() => approve(repo.root, 'c1', 'tests')).toThrow(stale);
  });

  it('refuses a baseline whose staged tests changed afterwards', () => {
    ready();
    writeBaseline();
    repo.write(`${C}/tests/stage/tests/acceptance/a.test.ts`, 'loosened');
    expect(() => approve(repo.root, 'c1', 'tests')).toThrow(/stale or invalid: .*inputs/);
  });

  it('expects retired rows to be absent and all rows to pass for a declared refactor', () => {
    ready({ [`${C}/retires.json`]: '["LST-001"]' });
    writeBaseline({ rows: {} });
    expect(() => approve(repo.root, 'c1', 'tests')).toThrow(/at least one row must fail/);
    repo.write(`${C}/change.json`, '{"level":"P1","noBehaviourChange":true}');
    approve(repo.root, 'c1', 'spec');
    approve(repo.root, 'c1', 'design');
    approve(repo.root, 'c1', 'tests');
    expect(checkGate(repo.root, 'c1', 'tests').status).toBe('valid');
  });
});
