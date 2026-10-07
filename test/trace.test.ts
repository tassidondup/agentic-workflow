import { afterEach, describe, expect, it } from 'vitest';
import type { TestCase } from '../src/junit.js';
import { requiredRows, rowOutcomes, traceCheck, traceImplementation } from '../src/trace.js';
import { CONFIG, approveAll, changeFiles } from './helpers/change.js';
import { makeRepo, type TestRepo } from './helpers/repo.js';

const tc = (rowIds: string[], status: TestCase['status']): TestCase => ({ name: rowIds.map((r) => `[${r}]`).join(''), classname: 'tests/acceptance/a.test.ts', file: 'tests/acceptance/a.test.ts', status, rowIds });

describe('rowOutcomes (Review Focus 4)', () => {
  it('passes when every executed test passes; skipped never counts as executed', () => {
    const out = rowOutcomes(['A-1', 'B-2', 'C-3', 'D-4'], [
      tc(['A-1'], 'passed'), tc(['A-1'], 'skipped'),
      tc(['B-2'], 'passed'), tc(['B-2'], 'failed'),
      tc(['C-3'], 'skipped'),
    ]);
    expect(Object.fromEntries(out)).toEqual({ 'A-1': 'passes', 'B-2': 'fails', 'C-3': 'not-run', 'D-4': 'not-run' });
  });
});

describe('traceImplementation', () => {
  it('is ok only when every required row passes', () => {
    expect(traceImplementation(['A-1'], [tc(['A-1'], 'passed')])).toEqual({ ok: true, problems: [] });
    expect(traceImplementation(['A-1', 'B-2'], [tc(['A-1'], 'failed')])).toEqual({
      ok: false,
      problems: ['A-1: failing', 'B-2: no executed test'],
    });
  });
  it('names the folder when a scope is given', () => {
    expect(traceImplementation(['B-2'], [], 'tests/acceptance').problems).toEqual(['B-2: no executed test under tests/acceptance']);
  });
});

describe('requiredRows', () => {
  let repo: TestRepo;
  afterEach(() => repo?.cleanup());
  it('is live rows plus change rows minus retired rows', () => {
    const t = (ids: string[]): string => ['| ID | x | Expected |', '|---|---|---|', ...ids.map((i) => `| ${i} | 1 | 2 |`)].join('\n');
    repo = makeRepo({
      'docs/specs/a/spec.md': t(['LST-001', 'LST-002']),
      'docs/changes/c1/spec-delta.md': t(['LST-003']),
      'docs/changes/c1/retires.json': '["LST-002"]',
    });
    expect(requiredRows(repo.root, 'c1')).toEqual(['LST-001', 'LST-003']);
  });
});

describe('traceCheck (I3)', () => {
  let repo: TestRepo;
  afterEach(() => repo?.cleanup());
  const pass = [tc(['LST-001'], 'passed')];
  it('throws when the change folder or its spec-delta.md is missing', () => {
    repo = makeRepo();
    expect(() => traceCheck(repo.root, 'c1', pass)).toThrow('Change c1 not found');
    repo.write('docs/changes/c1/proposal.md', 'p');
    expect(() => traceCheck(repo.root, 'c1', pass)).toThrow(/spec-delta\.md is missing/);
  });
  it('fails unless the tests gate is valid', () => {
    repo = makeRepo(changeFiles());
    expect(traceCheck(repo.root, 'c1', pass)).toEqual(['tests gate is missing; retirements and rows are not approved']);
    approveAll(repo);
    expect(traceCheck(repo.root, 'c1', pass)).toEqual([]);
    repo.write('docs/changes/c1/retires.json', '["LST-001"]');
    expect(traceCheck(repo.root, 'c1', [])).toEqual(['tests gate is changed; retirements and rows are not approved']);
  });
  it('reports malformed row IDs in the live specs and the delta instead of dropping them (I4)', () => {
    repo = makeRepo(changeFiles('c1', {
      'docs/specs/a/spec.md': 'ID | x | Expected\n---|---|---\nLST-12345 | 1 | 2\n',
      'docs/changes/c1/spec-delta.md': '| ID | x | Expected |\n|---|---|---|\n| LST-001 | 1 | 2 |\n| lst-2 | 1 | 2 |\n',
    }));
    approveAll(repo);
    expect(traceCheck(repo.root, 'c1', pass)).toEqual([
      'Malformed row ID "LST-12345" in docs/specs/a/spec.md:3',
      'Malformed row ID "lst-2" in docs/changes/c1/spec-delta.md:4',
    ]);
  });
  it('counts only tests under the acceptance folder (ADR 0001, Review Focus 1)', () => {
    repo = makeRepo(changeFiles());
    approveAll(repo);
    const decoy = { ...tc(['LST-001'], 'passed'), classname: 'src/decoy.test.ts', file: 'src/decoy.test.ts' };
    const sibling = { ...decoy, classname: 'tests/acceptance-evil/x.test.ts', file: 'tests/acceptance-evil/x.test.ts' };
    expect(traceCheck(repo.root, 'c1', [decoy, sibling])).toEqual(['LST-001: no executed test under tests/acceptance']);
  });
  it('fails closed on a row-tagged test with no file path (Review Focus 5)', () => {
    repo = makeRepo(changeFiles());
    approveAll(repo);
    const blind = { ...tc(['LST-001'], 'passed'), classname: '', file: '' };
    expect(traceCheck(repo.root, 'c1', [blind])).toEqual([
      'Test "[LST-001]" has no usable file path in the JUnit report (file=""); configure the reporter to record each test\'s file',
      'LST-001: no executed test under tests/acceptance',
    ]);
  });
  it('fails when the test settings changed after the tests gate (ADR 0001)', () => {
    repo = makeRepo(changeFiles());
    approveAll(repo);
    repo.write('workflow.config.json', CONFIG.replace('"tests/acceptance"', '"src"'));
    expect(traceCheck(repo.root, 'c1', pass)).toEqual([expect.stringMatching(/baseline\.json is stale or invalid: .*inputs_sha256 mismatch/)]);
  });
});
