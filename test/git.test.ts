import { afterEach, describe, expect, it } from 'vitest';
import { realExec } from '../src/exec.js';
import { assertRef, blobAt, changedFiles, lastCommitTouching } from '../src/git.js';
import { git, makeRepo, type TestRepo } from './helpers/repo.js';

let repo: TestRepo;
afterEach(() => repo?.cleanup());

function init(files: Record<string, string>): TestRepo {
  repo = makeRepo(files);
  git(repo.root, 'init', '-b', 'main');
  git(repo.root, 'add', '-A');
  git(repo.root, 'commit', '-m', 'base');
  return repo;
}

const commitAll = (message: string): string => {
  git(repo.root, 'add', '-A');
  git(repo.root, 'commit', '-m', message);
  return git(repo.root, 'rev-parse', 'HEAD').trim();
};

describe('changedFiles', () => {
  it('reports added, modified and deleted files', () => {
    init({ 'b.txt': 'one', 'c.txt': 'gone' });
    git(repo.root, 'checkout', '-b', 'feature');
    repo.write('a.txt', 'new');
    repo.write('b.txt', 'two');
    git(repo.root, 'rm', '-q', 'c.txt');
    commitAll('change');
    expect(changedFiles(repo.root, 'main', realExec)).toEqual([
      { status: 'A', path: 'a.txt' },
      { status: 'M', path: 'b.txt' },
      { status: 'D', path: 'c.txt' },
    ]);
  });

  it('reports a rename as delete plus add', () => {
    init({ 'd.txt': 'some content that stays identical\n' });
    git(repo.root, 'checkout', '-b', 'feature');
    git(repo.root, 'mv', 'd.txt', 'e.txt');
    commitAll('rename');
    expect(changedFiles(repo.root, 'main', realExec)).toEqual([
      { status: 'D', path: 'd.txt' },
      { status: 'A', path: 'e.txt' },
    ]);
  });

  it('ignores changes made only on the base after the branch point', () => {
    init({ 'f.txt': 'x' });
    git(repo.root, 'checkout', '-b', 'feature');
    repo.write('mine.txt', 'mine');
    commitAll('feature work');
    git(repo.root, 'checkout', 'main');
    repo.write('base-only.txt', 'later');
    commitAll('base moves on');
    git(repo.root, 'checkout', 'feature');
    expect(changedFiles(repo.root, 'main', realExec)).toEqual([{ status: 'A', path: 'mine.txt' }]);
  });

  it('returns a filename containing a newline intact', () => {
    init({ 'f.txt': 'x' });
    git(repo.root, 'checkout', '-b', 'feature');
    repo.write('we\nird.txt', 'odd');
    commitAll('odd name');
    expect(changedFiles(repo.root, 'main', realExec)).toEqual([{ status: 'A', path: 'we\nird.txt' }]);
  });

  it('throws on an unsafe base', () => {
    init({ 'f.txt': 'x' });
    expect(() => changedFiles(repo.root, '--output=/tmp/x', realExec)).toThrow(/Unsafe git ref/);
  });

  it('throws when git fails', () => {
    init({ 'f.txt': 'x' });
    expect(() => changedFiles(repo.root, 'no-such-base', realExec)).toThrow(/git diff failed/);
  });
});

describe('assertRef', () => {
  it.each(['--output=x', '-x', 'a b', 'a..b', '', 'a@{1}'])('rejects %j', (ref) => {
    expect(() => assertRef(ref)).toThrow(/Unsafe git ref/);
  });

  it.each(['origin/main', 'HEAD', 'a'.repeat(40)])('accepts %j unchanged', (ref) => {
    expect(assertRef(ref)).toBe(ref);
  });
});

describe('blobAt', () => {
  it('returns the blob sha, null for a missing path, and throws for an unknown ref', () => {
    init({ 'f.txt': 'hello\n' });
    const expected = git(repo.root, 'rev-parse', 'HEAD:f.txt').trim();
    expect(blobAt(repo.root, 'HEAD', 'f.txt', realExec)).toBe(expected);
    expect(blobAt(repo.root, 'HEAD', 'missing.txt', realExec)).toBeNull();
    expect(() => blobAt(repo.root, 'no-such-ref', 'f.txt', realExec)).toThrow(/git rev-parse failed/);
  });

  it('rejects an unsafe path and an unsafe ref', () => {
    init({ 'f.txt': 'x' });
    expect(() => blobAt(repo.root, 'HEAD', '../f.txt', realExec)).toThrow(/Unsafe repository path/);
    expect(() => blobAt(repo.root, '-x', 'f.txt', realExec)).toThrow(/Unsafe git ref/);
  });
});

describe('lastCommitTouching', () => {
  it('returns the newest commit that touched the path, null if none', () => {
    init({ 'g.txt': 'g' });
    repo.write('f', '1');
    commitAll('first touch');
    repo.write('f', '2');
    const second = commitAll('second touch');
    repo.write('g.txt', 'g2');
    commitAll('unrelated');
    expect(lastCommitTouching(repo.root, 'HEAD', 'f', realExec)).toBe(second);
    expect(lastCommitTouching(repo.root, 'HEAD', 'never.txt', realExec)).toBeNull();
  });

  it('rejects an unsafe ref', () => {
    init({ 'f.txt': 'x' });
    expect(() => lastCommitTouching(repo.root, '--all', 'f.txt', realExec)).toThrow(/Unsafe git ref/);
  });
});
