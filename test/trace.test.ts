import { afterEach, describe, expect, it } from 'vitest';
import type { TestCase } from '../src/junit.js';
import { requiredRows, rowOutcomes, traceImplementation } from '../src/trace.js';
import { makeRepo, type TestRepo } from './helpers/repo.js';

const tc = (rowIds: string[], status: TestCase['status']): TestCase => ({ name: rowIds.map((r) => `[${r}]`).join(''), classname: 'c', status, rowIds });

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
