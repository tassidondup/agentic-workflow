import { describe, expect, it } from 'vitest';
import { computeBaseline, type BaselineInput } from '../src/baseline.js';
import type { TestCase } from '../src/junit.js';

const tc = (id: string, status: TestCase['status']): TestCase => ({ name: `[${id}]`, classname: 'tests/acceptance/a.test.ts', file: 'tests/acceptance/a.test.ts', status, rowIds: [id] });
const live = new Set(['LST-001']);
const SHA = 'a'.repeat(64);
const input = (changeRowIds: string[], cases: TestCase[], noBehaviourChange = false, retired: string[] = []): BaselineInput =>
  ({ id: 'c1', changeRowIds, retired: new Set(retired), live, cases, noBehaviourChange, inputsSha256: SHA, manifest: { acceptance: [], harness: [] } });

describe('computeBaseline', () => {
  it('records passes and fails, binds the inputs hash, and requires at least one failing row', () => {
    const r = computeBaseline(input(['LST-001', 'LST-002'], [tc('LST-001', 'passed'), tc('LST-002', 'failed')]));
    expect(r.problems).toEqual([]);
    expect(r.baseline).toEqual({ change: 'c1', rows: { 'LST-001': 'passes', 'LST-002': 'fails' }, flags: [], inputs_sha256: SHA, acceptance: [], harness: [] });
  });
  it('carries the manifest into the baseline (ADR 0001)', () => {
    const manifest = {
      acceptance: [{ path: 'tests/acceptance/a.test.ts', sha256: SHA, rows: ['LST-001'] }],
      harness: [{ path: 'vitest.config.ts', sha256: null }],
    };
    const r = computeBaseline({ ...input(['LST-002'], [tc('LST-002', 'failed')]), manifest });
    expect(r.baseline?.acceptance).toEqual(manifest.acceptance);
    expect(r.baseline?.harness).toEqual(manifest.harness);
  });
  it('rejects a behaviour change where nothing fails at baseline', () => {
    const r = computeBaseline(input(['LST-001'], [tc('LST-001', 'passed')]));
    expect(r.baseline).toBeNull();
    expect(r.problems[0]).toMatch(/At least one row must fail/);
  });
  it('accepts all-passing rows when the change declares no behaviour change', () => {
    expect(computeBaseline(input(['LST-001'], [tc('LST-001', 'passed')], true)).baseline?.rows).toEqual({ 'LST-001': 'passes' });
  });
  it('rejects a declared refactor whose rows fail', () => {
    expect(computeBaseline(input(['LST-001'], [tc('LST-001', 'failed')], true)).problems[0]).toMatch(/declares no behaviour change/);
  });
  it('flags a new row that already passes', () => {
    const r = computeBaseline(input(['LST-002', 'LST-003'], [tc('LST-002', 'passed'), tc('LST-003', 'failed')]));
    expect(r.baseline?.flags).toEqual(['LST-002 is new in this change but already passes on main: weak test or existing behaviour. Decide before approving.']);
  });
  it('refuses rows with no executed test', () => {
    const r = computeBaseline(input(['LST-002'], [tc('LST-002', 'skipped')]));
    expect(r.baseline).toBeNull();
    expect(r.problems).toEqual(['LST-002: no executed test at baseline']);
  });
  it('excludes retired rows (M4)', () => {
    const r = computeBaseline(input(['LST-001', 'LST-002'], [tc('LST-002', 'failed')], false, ['LST-001']));
    expect(r.problems).toEqual([]);
    expect(r.baseline?.rows).toEqual({ 'LST-002': 'fails' });
  });
});
