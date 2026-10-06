import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256 } from '../src/hash.js';
import {
  hashRepoFile, listRepoFiles, listRepoFolders, lstatInRepo, readRepoFile, removeRepoFile, resolveInRepo, writeRepoFile,
} from '../src/safe-fs.js';
import { makeRepo, mkfifo, type TestRepo } from './helpers/repo.js';

let repo: TestRepo;
const outsides: string[] = [];
afterEach(() => {
  repo?.cleanup();
  outsides.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
});
const outsideDir = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'wf-outside-'));
  outsides.push(d);
  return d;
};

describe('resolveInRepo', () => {
  it('returns the absolute path, including for missing segments', () => {
    repo = makeRepo({ 'a/b.txt': 'b' });
    expect(resolveInRepo(repo.root, 'a/b.txt')).toBe(join(repo.root, 'a', 'b.txt'));
    expect(resolveInRepo(repo.root, 'a/missing/deeper.txt')).toBe(join(repo.root, 'a', 'missing', 'deeper.txt'));
  });
  it('rejects unsafe repo paths', () => {
    repo = makeRepo();
    expect(() => resolveInRepo(repo.root, '../x')).toThrow(/Unsafe repository path/);
  });
  it('names the first symlinked segment, whether a folder or the file itself', () => {
    repo = makeRepo({ 'real/x.txt': 'x' });
    repo.symlink(join(repo.root, 'real'), 'a/link');
    repo.symlink('nowhere', 'a/dangling');
    expect(() => resolveInRepo(repo.root, 'a/link/x.txt')).toThrow('Symlinks are not allowed: a/link');
    expect(() => resolveInRepo(repo.root, 'a/dangling')).toThrow('Symlinks are not allowed: a/dangling');
  });
});

describe('reading and hashing', () => {
  it('reads bytes or text and hashes file bytes (CRLF differs from LF)', () => {
    repo = makeRepo({ 'lf.md': 'a\nb\n', 'crlf.md': 'a\r\nb\r\n' });
    expect(readRepoFile(repo.root, 'lf.md', 'utf8')).toBe('a\nb\n');
    expect(readRepoFile(repo.root, 'lf.md')).toEqual(Buffer.from('a\nb\n'));
    expect(hashRepoFile(repo.root, 'lf.md')).toBe(sha256('a\nb\n'));
    expect(hashRepoFile(repo.root, 'lf.md')).not.toBe(hashRepoFile(repo.root, 'crlf.md'));
  });
  it('refuses missing files, folders, FIFOs and symlinks', () => {
    repo = makeRepo({ 'd/x.txt': 'x' });
    mkfifo(join(repo.root, 'd', 'pipe'));
    repo.symlink('/etc/hosts', 'd/hosts');
    expect(() => readRepoFile(repo.root, 'd/none.txt')).toThrow('No such file: d/none.txt');
    expect(() => readRepoFile(repo.root, 'd')).toThrow('Not a regular file: d');
    expect(() => hashRepoFile(repo.root, 'd/pipe')).toThrow('Not a regular file: d/pipe');
    expect(() => readRepoFile(repo.root, 'd/hosts')).toThrow('Symlinks are not allowed: d/hosts');
  });
  it('lstatInRepo returns null for a missing path and refuses symlinks on the way', () => {
    repo = makeRepo({ 'f.txt': 'f' });
    repo.symlink('/tmp', 'link');
    expect(lstatInRepo(repo.root, 'f.txt')?.isFile()).toBe(true);
    expect(lstatInRepo(repo.root, 'none/deeper')).toBeNull();
    expect(lstatInRepo(repo.root, 'f.txt/below')).toBeNull();
    expect(() => lstatInRepo(repo.root, 'link/x')).toThrow(/Symlinks are not allowed: link/);
  });
});

describe('writeRepoFile', () => {
  it('creates parent folders and writes the file', () => {
    repo = makeRepo();
    writeRepoFile(repo.root, 'a/b/c.txt', 'hello');
    expect(readFileSync(join(repo.root, 'a', 'b', 'c.txt'), 'utf8')).toBe('hello');
  });
  it('refuses to write through a symlinked folder and leaves the outside folder empty', () => {
    const out = outsideDir();
    repo = makeRepo();
    repo.symlink(out, 'a/link');
    expect(() => writeRepoFile(repo.root, 'a/link/sub/x.txt', 'x')).toThrow('Symlinks are not allowed: a/link');
    expect(readdirSync(out)).toEqual([]);
  });
  it('refuses to write through a symlinked file and leaves the outside file unchanged', () => {
    const out = join(outsideDir(), 'target.txt');
    writeFileSync(out, 'original');
    repo = makeRepo();
    repo.symlink(out, 'x.txt');
    expect(() => writeRepoFile(repo.root, 'x.txt', 'evil')).toThrow('Symlinks are not allowed: x.txt');
    expect(readFileSync(out, 'utf8')).toBe('original');
  });
  it('refuses to write over a FIFO or through a file used as a folder', () => {
    repo = makeRepo({ 'f.txt': 'f' });
    mkfifo(join(repo.root, 'pipe'));
    expect(() => writeRepoFile(repo.root, 'pipe', 'x')).toThrow('Not a regular file: pipe');
    expect(() => writeRepoFile(repo.root, 'f.txt/x', 'x')).toThrow('Not a folder: f.txt');
  });
});

describe('removeRepoFile', () => {
  it('removes a regular file, ignores a missing one and refuses symlinks', () => {
    repo = makeRepo({ 'r/a.xml': 'a' });
    repo.symlink('/etc/hosts', 'r/b.xml');
    removeRepoFile(repo.root, 'r/a.xml');
    removeRepoFile(repo.root, 'r/none.xml');
    expect(lstatInRepo(repo.root, 'r/a.xml')).toBeNull();
    expect(() => removeRepoFile(repo.root, 'r/b.xml')).toThrow(/Symlinks are not allowed/);
  });
});

describe('listRepoFiles', () => {
  it('lists repo paths recursively in sorted order and returns [] for a missing folder', () => {
    repo = makeRepo({ 'd/b.txt': 'b', 'd/a.txt': 'a', 'd/sub/c.txt': 'c' });
    expect(listRepoFiles(repo.root, 'd')).toEqual(['d/a.txt', 'd/b.txt', 'd/sub/c.txt']);
    expect(listRepoFiles(repo.root, 'missing')).toEqual([]);
  });
  it('refuses a symlink inside the folder', () => {
    repo = makeRepo({ 'd/a.txt': 'a' });
    symlinkSync('/etc/hosts', join(repo.root, 'd', 'link'));
    expect(() => listRepoFiles(repo.root, 'd')).toThrow('Symlinks are not allowed: d/link');
  });
  it('refuses when the folder or one of its ancestors is a symlink', () => {
    repo = makeRepo({ 'real/a.txt': 'a' });
    mkdirSync(join(repo.root, 'x'));
    symlinkSync(join(repo.root, 'real'), join(repo.root, 'x', 'linked'));
    expect(() => listRepoFiles(repo.root, 'x/linked')).toThrow('Symlinks are not allowed: x/linked');
    expect(() => listRepoFiles(repo.root, 'x/linked/deeper')).toThrow('Symlinks are not allowed: x/linked');
  });
  it('refuses special files such as FIFOs, and a file given as the folder', () => {
    repo = makeRepo({ 'd/a.txt': 'a' });
    mkfifo(join(repo.root, 'd', 'pipe'));
    expect(() => listRepoFiles(repo.root, 'd')).toThrow('Not a regular file: d/pipe');
    expect(() => listRepoFiles(repo.root, 'd/a.txt')).toThrow('Not a folder: d/a.txt');
  });
});

describe('listRepoFolders', () => {
  it('lists direct subfolder names sorted, ignores files, [] when missing', () => {
    repo = makeRepo({ 'd/b/x': 'x', 'd/a/x': 'x', 'd/file.md': 'f' });
    expect(listRepoFolders(repo.root, 'd')).toEqual(['a', 'b']);
    expect(listRepoFolders(repo.root, 'missing')).toEqual([]);
  });
  it('refuses a symlinked subfolder', () => {
    repo = makeRepo({ 'real/x': 'x', 'd/a/x': 'x' });
    symlinkSync(join(repo.root, 'real'), join(repo.root, 'd', 'linked'));
    expect(() => listRepoFolders(repo.root, 'd')).toThrow('Symlinks are not allowed: d/linked');
  });
});
