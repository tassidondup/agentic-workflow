import { afterEach, describe, expect, it } from 'vitest';
import { changeRowIds, liveRowIds, openChangeIds } from '../src/spec-index.js';
import { lintChange } from '../src/spec-lint.js';
import { makeRepo, type TestRepo } from './helpers/repo.js';

let repo: TestRepo;
afterEach(() => repo?.cleanup());
const table = (rows: string[]): string => ['| ID | Price | Expected |', '|---|---|---|', ...rows].join('\n');

describe('spec index', () => {
  it('collects live rows, change rows and open changes (excluding archive)', () => {
    repo = makeRepo({
      'docs/specs/listing/spec.md': table(['| LST-001 | 1 | 201 |']),
      'docs/changes/c1/spec-delta.md': table(['| LST-002 | 0 | 422 |', '| LST-002 | 0 | 422 |', '| bad | 1 | x |']),
      'docs/changes/archive/old/spec-delta.md': table(['| LST-003 | 1 | 1 |']),
    });
    expect([...liveRowIds(repo.root)]).toEqual(['LST-001']);
    expect(changeRowIds(repo.root, 'c1')).toEqual(['LST-002']);
    expect(openChangeIds(repo.root)).toEqual(['c1']);
  });
});

describe('lintChange', () => {
  it('passes a clean delta', () => {
    repo = makeRepo({ 'docs/changes/c1/spec-delta.md': table(['| LST-001 | 0 | 422 |', '| LST-002 | 1 | 201 |']) });
    expect(lintChange(repo.root, 'c1')).toEqual([]);
  });
  it('reports malformed ids, duplicates and conflicting rows', () => {
    repo = makeRepo({
      'docs/changes/c1/spec-delta.md': table(['| lst-1 | 0 | 422 |', '| LST-002 | 5 | 201 |', '| LST-002 | 6 | 201 |', '| LST-003 | 5 | 422 |']),
    });
    const messages = lintChange(repo.root, 'c1').map((i) => i.message);
    expect(messages).toContain('Row ID "lst-1" must look like LST-004');
    expect(messages).toContain('Row ID LST-002 appears more than once');
    expect(messages).toContain('LST-003 has the same inputs as LST-002 but a different Expected value');
  });
  it('reports a table without an Expected column', () => {
    repo = makeRepo({ 'docs/changes/c1/spec-delta.md': '| ID | Price |\n|---|---|\n| LST-001 | 0 |' });
    expect(lintChange(repo.root, 'c1').map((i) => i.message)).toContain('Row LST-001 is in a table without an Expected column');
  });
  it('reports a new row id that another open change also introduces, but allows modifying a live row', () => {
    repo = makeRepo({
      'docs/specs/listing/spec.md': table(['| LST-001 | 1 | 201 |']),
      'docs/changes/c1/spec-delta.md': table(['| LST-001 | 1 | 202 |', '| LST-005 | 0 | 422 |']),
      'docs/changes/c2/spec-delta.md': table(['| LST-005 | 9 | 201 |']),
    });
    expect(lintChange(repo.root, 'c1').map((i) => i.message)).toEqual(['New row LST-005 is also introduced by open change c2']);
  });
  it('reports a missing spec-delta.md', () => {
    repo = makeRepo();
    expect(lintChange(repo.root, 'c1').map((i) => i.message)).toEqual(['spec-delta.md is missing']);
  });
  it('throws when spec-delta.md is a symlink', () => {
    repo = makeRepo();
    repo.symlink('external-file.md', 'docs/changes/c1/spec-delta.md');
    expect(() => lintChange(repo.root, 'c1')).toThrow('Symlinks are not allowed: docs/changes/c1/spec-delta.md');
  });
  it('reports a delta with no example rows unless the change declares no behaviour change (I4)', () => {
    const msg = 'spec-delta.md has no example rows';
    repo = makeRepo({ 'docs/changes/c1/spec-delta.md': 'Prose only.', 'docs/changes/c1/change.json': '{"level":"P1","noBehaviourChange":false}' });
    expect(lintChange(repo.root, 'c1')).toEqual([{ file: 'docs/changes/c1/spec-delta.md', line: 0, message: msg }]);
    repo.write('docs/changes/c1/change.json', '{oops');
    expect(lintChange(repo.root, 'c1').map((i) => i.message)).toEqual([msg]);
    repo.write('docs/changes/c1/change.json', '{"level":"P1","noBehaviourChange":true}');
    expect(lintChange(repo.root, 'c1')).toEqual([]);
  });
});
