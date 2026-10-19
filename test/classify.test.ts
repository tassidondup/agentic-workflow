import { describe, expect, it } from 'vitest';
import { classifyPr } from '../src/classify.js';
import { exemptPolicy } from '../src/exempt.js';
import type { ChangedFile } from '../src/git.js';

const f = (status: string, path: string, mode = '100644'): ChangedFile => ({ status, path, mode });

const TEST = { acceptanceDir: 'tests/acceptance', harness: ['vitest.config.ts'] };
/** Gate and change PRs must never read the policy, so the default throws. */
const unread = (): never => {
  throw new Error('policy must not be read');
};
const withExempt = (exempt: string[]) => () => exemptPolicy({ exempt, test: TEST });

describe('classifyPr', () => {
  it('a lone approval record under its own change folder is a clean gate PR', () => {
    const files = [
      f('A', 'docs/changes/c1/approvals/tests.json'),
      f('A', 'docs/changes/c1/baseline.json'),
      f('A', 'docs/changes/c1/tests/stage/x.ts'),
    ];
    expect(classifyPr(files, 'gate/c1-tests', unread)).toEqual({ kind: 'gate', change: 'c1', gate: 'tests', problems: [] });
  });

  it('a gate PR that also edits vitest.config.ts is rejected', () => {
    const files = [f('A', 'docs/changes/c1/approvals/tests.json'), f('M', 'vitest.config.ts')];
    const r = classifyPr(files, 'gate/c1-tests', unread);
    expect(r.kind).toBe('gate');
    expect(r.problems).toContain('vitest.config.ts is outside docs/changes/c1/');
  });

  it("a gate PR that edits another change's folder is rejected", () => {
    const files = [f('A', 'docs/changes/c1/approvals/spec.json'), f('M', 'docs/changes/c2/proposal.md')];
    expect(classifyPr(files, 'gate/c1-spec', unread).problems).toContain('docs/changes/c2/proposal.md is outside docs/changes/c1/');
  });

  it('two records in one PR are rejected', () => {
    const files = [f('A', 'docs/changes/c1/approvals/spec.json'), f('A', 'docs/changes/c1/approvals/design.json')];
    const r = classifyPr(files, 'gate/c1-spec', unread);
    expect(r.kind).toBe('gate');
    expect(r.problems.join('\n')).toMatch(/one gate per PR/);
  });

  it('records for two changes are rejected', () => {
    const files = [f('A', 'docs/changes/c1/approvals/spec.json'), f('A', 'docs/changes/c2/approvals/spec.json')];
    const r = classifyPr(files, 'gate/c1-spec', unread);
    expect(r.kind).toBe('gate');
    expect(r.problems.join('\n')).toMatch(/second change/);
  });

  it('a deleted file outside the change folder is rejected in a gate PR', () => {
    const files = [f('A', 'docs/changes/c1/approvals/spec.json'), f('D', 'src/guard.ts')];
    expect(classifyPr(files, 'gate/c1-spec', unread).problems).toContain('src/guard.ts is outside docs/changes/c1/');
  });

  it('a deleted record does not make a gate PR, and its folder is never exempt', () => {
    const r = classifyPr([f('D', 'docs/changes/c1/approvals/spec.json')], 'cleanup', withExempt(['docs']));
    expect(r.kind).toBe('rejected');
    expect(r.problems).toEqual(['docs/changes/c1/approvals/spec.json is not exempt, and this PR is neither a gate PR nor on a change/<id> branch']);
  });

  it('a type-changed record still counts as a record', () => {
    expect(classifyPr([f('T', 'docs/changes/c1/approvals/design.json')], 'gate/c1-design', unread).gate).toBe('design');
  });

  it('branch change/c1 without records is an implementation PR', () => {
    const r = classifyPr([f('M', 'src/a.ts')], 'change/c1', unread);
    expect(r).toEqual({ kind: 'change', change: 'c1', gate: null, problems: [] });
  });

  it('branch change/Bad_ID is rejected with a problem', () => {
    const r = classifyPr([f('M', 'src/a.ts')], 'change/Bad_ID', unread);
    expect(r.kind).toBe('rejected');
    expect(r.problems).toContain('branch change/Bad_ID is not a valid change id');
  });

  it('gate PR on branch change/c2 for change c1 is rejected', () => {
    const r = classifyPr([f('A', 'docs/changes/c1/approvals/spec.json')], 'change/c2', unread);
    expect(r.kind).toBe('gate');
    expect(r.problems.join('\n')).toMatch(/change\/c2/);
  });

  it('a branch name with shell metacharacters is returned only as data', () => {
    const r = classifyPr([f('M', 'src/a.ts')], 'change/c1;rm -rf', unread);
    expect(r.kind).toBe('rejected');
    expect(r.problems).toEqual(['branch change/c1;rm -rf is not a valid change id']);
  });

  it('returns frozen results', () => {
    const r = classifyPr([f('A', 'docs/changes/c1/approvals/spec.json')], 'x', unread);
    expect(Object.isFrozen(r)).toBe(true);
    expect(Object.isFrozen(r.problems)).toBe(true);
  });

  it('a change/<id> PR never reads the policy, even when every path is exempt', () => {
    expect(classifyPr([f('M', 'README.md')], 'change/c1', unread)).toEqual({ kind: 'change', change: 'c1', gate: null, problems: [] });
  });
});

describe('classifyPr: default-deny for PRs that are neither gate nor change', () => {
  const cls = (files: ChangedFile[], exempt: string[] = [], branch = 'feat/x') => classifyPr(files, branch, withExempt(exempt));
  const NOT_EXEMPT = 'is not exempt, and this PR is neither a gate PR nor on a change/<id> branch';

  it('rejects an implementation change on an ordinary branch (the Codex finding)', () => {
    const r = cls([f('M', 'src/a.ts')], ['docs']);
    expect(r).toEqual({ kind: 'rejected', change: null, gate: null, problems: [`src/a.ts ${NOT_EXEMPT}`] });
  });
  it('rejects everything when nothing is exempt', () => {
    expect(cls([f('M', 'README.md')]).kind).toBe('rejected');
  });
  it('passes a PR whose every path is exempt, whatever the branch is called', () => {
    const files = [f('M', 'README.md'), f('A', 'docs/guides/a.md')];
    for (const branch of ['feat/x', 'main-fix', 'gate', 'changes/c1']) {
      expect(cls(files, ['README.md', 'docs/guides'], branch)).toEqual({ kind: 'exempt', change: null, gate: null, problems: [] });
    }
  });
  it('passes an empty diff', () => {
    expect(cls([]).kind).toBe('exempt');
  });
  it('rejects a mixed PR and names only the offending path', () => {
    const r = cls([f('M', 'README.md'), f('M', 'src/a.ts')], ['README.md']);
    expect(r.kind).toBe('rejected');
    expect(r.problems).toEqual([`src/a.ts ${NOT_EXEMPT}`]);
  });
  it('lets the floor win over an exempt folder', () => {
    const r = cls([f('M', 'docs/specs/a.md'), f('M', 'docs/guides/a.md')], ['docs']);
    expect(r.problems).toEqual([`docs/specs/a.md ${NOT_EXEMPT}`]);
  });
  it.each(['Docs/Specs/a.md', '.GitHub/workflows/wf.yml', 'AGENTS.MD', 'workflow.config.json', 'tests/acceptance/a.test.ts', 'vitest.config.mts', 'apps/web/package.json'])(
    'rejects the protected path %s even if its folder is exempt',
    (path) => {
      expect(cls([f('M', path)], ['Docs', 'docs', '.GitHub', 'tests', 'apps', 'AGENTS.MD']).kind).toBe('rejected');
    },
  );
  it('rejects deleting a non-exempt file and moving one out of an exempt folder', () => {
    expect(cls([f('D', 'src/guard.ts')], ['docs']).kind).toBe('rejected');
    const moved = cls([f('D', 'docs/guides/a.md'), f('A', 'src/a.md')], ['docs/guides']);
    expect(moved.problems).toEqual([`src/a.md ${NOT_EXEMPT}`]);
  });
  it('rejects a symlink or submodule at an exempt path', () => {
    expect(cls([f('A', 'docs/guides/link.md', '120000')], ['docs/guides']).kind).toBe('rejected');
    expect(cls([f('A', 'docs/guides/vendor', '160000')], ['docs/guides']).kind).toBe('rejected');
  });
  it('lists at most 10 paths and counts the rest', () => {
    const files = Array.from({ length: 13 }, (_, i) => f('A', `src/f${i}.ts`));
    const r = cls(files);
    expect(r.problems).toHaveLength(11);
    expect(r.problems[10]).toBe('and 3 more paths that are not exempt');
  });
  it('returns a hostile path as data and freezes the result', () => {
    const r = cls([f('A', 'x\n::error::boom')]);
    expect(r.problems).toEqual([`x\n::error::boom ${NOT_EXEMPT}`]);
    expect(Object.isFrozen(r)).toBe(true);
  });
  it('propagates a policy error instead of passing', () => {
    expect(() => classifyPr([f('M', 'README.md')], 'feat/x', unread)).toThrow(/policy must not be read/);
  });
});
