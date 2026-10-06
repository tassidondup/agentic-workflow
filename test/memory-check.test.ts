import { afterEach, describe, expect, it } from 'vitest';
import { memoryCheck } from '../src/memory-check.js';
import { makeRepo, type TestRepo } from './helpers/repo.js';

let repo: TestRepo;
afterEach(() => repo?.cleanup());
const base = { 'docs/context.md': '# Context\nSee [specs](specs/) and [site](https://x.dev) and [top](#top).\n', 'docs/glossary.md': '# Glossary\n', 'docs/specs/.keep': '' };

describe('memoryCheck', () => {
  it('passes a healthy repo', () => {
    repo = makeRepo(base);
    expect(memoryCheck(repo.root)).toEqual([]);
  });
  it('reports a missing context.md and glossary.md', () => {
    repo = makeRepo();
    expect(memoryCheck(repo.root).map((i) => i.message)).toEqual(['docs/context.md is missing', 'docs/glossary.md is missing']);
  });
  it('reports a context.md over 150 lines', () => {
    repo = makeRepo({ ...base, 'docs/context.md': Array.from({ length: 151 }, (_, i) => `line ${i}`).join('\n') });
    expect(memoryCheck(repo.root).map((i) => i.message)).toContain('docs/context.md has 151 lines; the limit is 150');
  });
  it('reports a broken relative link with its line number', () => {
    repo = makeRepo({ ...base, 'docs/context.md': '# C\n\nRead [the plan](plans/missing.md).\n' });
    expect(memoryCheck(repo.root)).toEqual([{ file: 'docs/context.md', line: 3, message: 'Broken link: plans/missing.md' }]);
  });
  it('requires decisions-audit.md once a change has a tests approval', () => {
    repo = makeRepo({ ...base, 'docs/changes/c1/approvals/tests.json': '{}' });
    expect(memoryCheck(repo.root).map((i) => i.message)).toEqual(['Change c1 has approved tests but no decisions-audit.md']);
  });
  it('reports invalid change id without crashing', () => {
    repo = makeRepo({ ...base, 'docs/changes/BAD_ID/approvals/tests.json': '{}' });
    expect(memoryCheck(repo.root).map((i) => i.message)).toEqual(['docs/changes/BAD_ID is not a valid change id']);
  });
  it('reports link pointing outside repo', () => {
    repo = makeRepo({ ...base, 'docs/context.md': '# C\n\nAccess [etc](../../../etc/hosts).\n' });
    expect(memoryCheck(repo.root)).toEqual([{ file: 'docs/context.md', line: 3, message: 'Link points outside the repository: ../../../etc/hosts' }]);
  });
  it('handles links with titles and missing links', () => {
    repo = makeRepo({ ...base, 'docs/context.md': '# C\n\nRead [specs](specs/ "Title") and [missing](missing.md "Title").\n' });
    const issues = memoryCheck(repo.root);
    expect(issues.map((i) => i.message)).toEqual(['Broken link: missing.md']);
  });
  it('resolves percent-encoded and angle-bracket links', () => {
    repo = makeRepo({ ...base, 'docs/a b.md': '# File', 'docs/context.md': '# C\n\nRead [percent](a%20b.md) and [angle](<a b.md>).\n' });
    expect(memoryCheck(repo.root)).toEqual([]);
  });
});
