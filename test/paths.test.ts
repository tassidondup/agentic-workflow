import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import {
  assertChangeId, assertSafeRepoPath, changeDir, changeRepoDir, fromRepoPath, toRepoPath,
} from '../src/paths.js';
import { makeRepo, type TestRepo } from './helpers/repo.js';

let repo: TestRepo;
afterEach(() => repo?.cleanup());

describe('assertChangeId', () => {
  it('accepts kebab-case ids', () => {
    expect(assertChangeId('listing-price-limits')).toBe('listing-price-limits');
  });
  it.each(['Bad', '../x', '', 'a', '-lead', 'trail-', 'x'.repeat(65), 'with space'])('rejects %j', (id) => {
    expect(() => assertChangeId(id)).toThrow(/Invalid change id/);
  });
});

describe('assertSafeRepoPath', () => {
  it('accepts a normal relative path', () => {
    expect(assertSafeRepoPath('docs/specs/a b.md')).toBe('docs/specs/a b.md');
  });
  it.each(['../etc/passwd', '/etc/passwd', 'a//b', 'a\\b', './a', 'a/./b', 'C:/x', ''])('rejects %j', (p) => {
    expect(() => assertSafeRepoPath(p)).toThrow(/Unsafe repository path/);
  });
});

describe('repo path conversion', () => {
  it('round-trips between repo paths and absolute paths', () => {
    repo = makeRepo();
    const abs = fromRepoPath(repo.root, 'docs/changes/x/spec-delta.md');
    expect(abs).toBe(join(repo.root, 'docs', 'changes', 'x', 'spec-delta.md'));
    expect(toRepoPath(repo.root, abs)).toBe('docs/changes/x/spec-delta.md');
  });
  it('refuses absolute paths outside the root', () => {
    repo = makeRepo();
    expect(() => toRepoPath(repo.root, join(repo.root, '..', 'elsewhere'))).toThrow(/outside the repository/);
  });
  it('builds the change folder path and validates the id', () => {
    repo = makeRepo();
    expect(changeDir(repo.root, 'abc')).toBe(join(repo.root, 'docs', 'changes', 'abc'));
    expect(() => changeDir(repo.root, '../abc')).toThrow(/Invalid change id/);
    expect(changeRepoDir('abc')).toBe('docs/changes/abc');
    expect(() => changeRepoDir('../abc')).toThrow(/Invalid change id/);
  });
});
