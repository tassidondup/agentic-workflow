import { describe, expect, it } from 'vitest';
import { computeBaseline } from '../src/baseline.js';
import type { TestCase } from '../src/junit.js';

const tc = (id: string, status: TestCase['status']): TestCase => ({ name: `[${id}]`, classname: 'c', status, rowIds: [id] });
const live = new Set(['LST-001']);

describe('computeBaseline', () => {
  it('records passes and fails and requires at least one failing row', () => {
    const r = computeBaseline('c1', ['LST-001', 'LST-002'], live, [tc('LST-001', 'passed'), tc('LST-002', 'failed')], false);
    expect(r.problems).toEqual([]);
    expect(r.baseline).toEqual({ change: 'c1', rows: { 'LST-001': 'passes', 'LST-002': 'fails' }, flags: [] });
  });
  it('rejects a behaviour change where nothing fails at baseline', () => {
    const r = computeBaseline('c1', ['LST-001'], live, [tc('LST-001', 'passed')], false);
    expect(r.baseline).toBeNull();
    expect(r.problems[0]).toMatch(/At least one row must fail/);
  });
  it('accepts all-passing rows when the change declares no behaviour change', () => {
    expect(computeBaseline('c1', ['LST-001'], live, [tc('LST-001', 'passed')], true).baseline?.rows).toEqual({ 'LST-001': 'passes' });
  });
  it('rejects a declared refactor whose rows fail', () => {
    expect(computeBaseline('c1', ['LST-001'], live, [tc('LST-001', 'failed')], true).problems[0]).toMatch(/declares no behaviour change/);
  });
  it('flags a new row that already passes', () => {
    const r = computeBaseline('c1', ['LST-002', 'LST-003'], live, [tc('LST-002', 'passed'), tc('LST-003', 'failed')], false);
    expect(r.baseline?.flags).toEqual(['LST-002 is new in this change but already passes on main: weak test or existing behaviour. Decide before approving.']);
  });
  it('refuses rows with no executed test', () => {
    const r = computeBaseline('c1', ['LST-002'], live, [tc('LST-002', 'skipped')], false);
    expect(r.baseline).toBeNull();
    expect(r.problems).toEqual(['LST-002: no executed test at baseline']);
  });
});
