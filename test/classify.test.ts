import { describe, expect, it } from 'vitest';
import { classifyPr } from '../src/classify.js';
import type { ChangedFile } from '../src/git.js';

const f = (status: string, path: string, mode = '100644'): ChangedFile => ({ status, path, mode });

describe('classifyPr', () => {
  it('a lone approval record under its own change folder is a clean gate PR', () => {
    const files = [
      f('A', 'docs/changes/c1/approvals/tests.json'),
      f('A', 'docs/changes/c1/baseline.json'),
      f('A', 'docs/changes/c1/tests/stage/x.ts'),
    ];
    expect(classifyPr(files, 'gate/c1-tests')).toEqual({ kind: 'gate', change: 'c1', gate: 'tests', problems: [] });
  });

  it('a gate PR that also edits vitest.config.ts is rejected', () => {
    const files = [f('A', 'docs/changes/c1/approvals/tests.json'), f('M', 'vitest.config.ts')];
    const r = classifyPr(files, 'gate/c1-tests');
    expect(r.kind).toBe('gate');
    expect(r.problems).toContain('vitest.config.ts is outside docs/changes/c1/');
  });

  it("a gate PR that edits another change's folder is rejected", () => {
    const files = [f('A', 'docs/changes/c1/approvals/spec.json'), f('M', 'docs/changes/c2/proposal.md')];
    expect(classifyPr(files, 'gate/c1-spec').problems).toContain('docs/changes/c2/proposal.md is outside docs/changes/c1/');
  });

  it('two records in one PR are rejected', () => {
    const files = [f('A', 'docs/changes/c1/approvals/spec.json'), f('A', 'docs/changes/c1/approvals/design.json')];
    const r = classifyPr(files, 'gate/c1-spec');
    expect(r.kind).toBe('gate');
    expect(r.problems.join('\n')).toMatch(/one gate per PR/);
  });

  it('records for two changes are rejected', () => {
    const files = [f('A', 'docs/changes/c1/approvals/spec.json'), f('A', 'docs/changes/c2/approvals/spec.json')];
    const r = classifyPr(files, 'gate/c1-spec');
    expect(r.kind).toBe('gate');
    expect(r.problems.join('\n')).toMatch(/second change/);
  });

  it('a deleted file outside the change folder is rejected in a gate PR', () => {
    const files = [f('A', 'docs/changes/c1/approvals/spec.json'), f('D', 'src/guard.ts')];
    expect(classifyPr(files, 'gate/c1-spec').problems).toContain('src/guard.ts is outside docs/changes/c1/');
  });

  it('a deleted record does not make a gate PR', () => {
    const r = classifyPr([f('D', 'docs/changes/c1/approvals/spec.json')], 'cleanup');
    expect(r).toEqual({ kind: 'other', change: null, gate: null, problems: [] });
  });

  it('a type-changed record still counts as a record', () => {
    expect(classifyPr([f('T', 'docs/changes/c1/approvals/design.json')], 'gate/c1-design').gate).toBe('design');
  });

  it('branch change/c1 without records is an implementation PR', () => {
    const r = classifyPr([f('M', 'src/a.ts')], 'change/c1');
    expect(r).toEqual({ kind: 'change', change: 'c1', gate: null, problems: [] });
  });

  it('branch change/Bad_ID is other with a problem', () => {
    const r = classifyPr([f('M', 'src/a.ts')], 'change/Bad_ID');
    expect(r.kind).toBe('other');
    expect(r.problems).toContain('branch change/Bad_ID is not a valid change id');
  });

  it('gate PR on branch change/c2 for change c1 is rejected', () => {
    const r = classifyPr([f('A', 'docs/changes/c1/approvals/spec.json')], 'change/c2');
    expect(r.kind).toBe('gate');
    expect(r.problems.join('\n')).toMatch(/change\/c2/);
  });

  it('an unrelated branch with no records is other', () => {
    expect(classifyPr([f('M', 'README.md')], 'feat/x')).toEqual({ kind: 'other', change: null, gate: null, problems: [] });
  });

  it('a branch name with shell metacharacters is returned only as data', () => {
    const r = classifyPr([f('M', 'src/a.ts')], 'change/c1;rm -rf');
    expect(r.kind).toBe('other');
    expect(r.problems).toEqual(['branch change/c1;rm -rf is not a valid change id']);
  });

  it('returns frozen results', () => {
    const r = classifyPr([f('A', 'docs/changes/c1/approvals/spec.json')], 'x');
    expect(Object.isFrozen(r)).toBe(true);
    expect(Object.isFrozen(r.problems)).toBe(true);
  });
});
