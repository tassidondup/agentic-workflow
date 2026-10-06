// The one place that touches repository content on disk. Every read, hash, write and
// listing goes through resolveInRepo, which refuses any symlink on the way from the repo
// root to the target, and refuses anything that is not a regular file or folder.
import {
  closeSync, constants, fchmodSync, fstatSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, unlinkSync, writeFileSync,
  type Dirent, type Stats,
} from 'node:fs';
import { join } from 'node:path';
import { sha256 } from './hash.js';
import { assertSafeRepoPath } from './paths.js';

const NOFOLLOW = constants.O_NOFOLLOW ?? 0;
const NONBLOCK = constants.O_NONBLOCK ?? 0;

function lstatOrNull(abs: string): Stats | null {
  try {
    return lstatSync(abs);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    throw e;
  }
}

const notRegular = (repoPath: string): Error => new Error(`Not a regular file: ${repoPath}`);

/** Absolute path for a repo path; throws if any existing segment is a symlink. */
export function resolveInRepo(root: string, repoPath: string): string {
  const parts = assertSafeRepoPath(repoPath).split('/');
  let abs = root;
  for (let i = 0; i < parts.length; i += 1) {
    abs = join(abs, parts[i] as string);
    const stat = lstatOrNull(abs);
    if (stat === null) return join(abs, ...parts.slice(i + 1));
    if (stat.isSymbolicLink()) throw new Error(`Symlinks are not allowed: ${parts.slice(0, i + 1).join('/')}`);
  }
  return abs;
}

/** lstat of a repo path (null if missing); throws on a symlink anywhere on the way. */
export const lstatInRepo = (root: string, repoPath: string): Stats | null => lstatOrNull(resolveInRepo(root, repoPath));

export function readRepoFile(root: string, repoPath: string): Buffer;
export function readRepoFile(root: string, repoPath: string, encoding: 'utf8'): string;
export function readRepoFile(root: string, repoPath: string, encoding?: 'utf8'): Buffer | string {
  const stat = lstatInRepo(root, repoPath);
  if (stat === null) throw Object.assign(new Error(`No such file: ${repoPath}`), { code: 'ENOENT' });
  if (!stat.isFile()) throw notRegular(repoPath);
  // O_NONBLOCK: if a FIFO is swapped in after the lstat above, open returns instead of hanging,
  // and the fstat below refuses it.
  const fd = openSync(resolveInRepo(root, repoPath), constants.O_RDONLY | NOFOLLOW | NONBLOCK);
  try {
    if (!fstatSync(fd).isFile()) throw notRegular(repoPath);
    return encoding ? readFileSync(fd, encoding) : readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}

export const hashRepoFile = (root: string, repoPath: string): string => sha256(readRepoFile(root, repoPath));

function ensureFolder(root: string, repoDir: string): void {
  const parts = repoDir.split('/');
  for (let i = 1; i <= parts.length; i += 1) {
    const sub = parts.slice(0, i).join('/');
    const stat = lstatInRepo(root, sub);
    if (stat === null) mkdirSync(resolveInRepo(root, sub));
    else if (!stat.isDirectory()) throw new Error(`Not a folder: ${sub}`);
  }
}

/** Writes a regular file, creating parent folders. A given `mode` is applied even if the file existed. */
export function writeRepoFile(root: string, repoPath: string, data: string | Uint8Array, mode?: number): void {
  const parts = assertSafeRepoPath(repoPath).split('/');
  if (parts.length > 1) ensureFolder(root, parts.slice(0, -1).join('/'));
  const stat = lstatInRepo(root, repoPath);
  if (stat !== null && !stat.isFile()) throw notRegular(repoPath);
  const fd = openSync(resolveInRepo(root, repoPath), constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | NOFOLLOW, mode ?? 0o644);
  try {
    writeFileSync(fd, data);
    if (mode !== undefined) fchmodSync(fd, mode);
  } finally {
    closeSync(fd);
  }
}

/** Deletes a regular file if present; refuses symlinks and special files. */
export function removeRepoFile(root: string, repoPath: string): void {
  const stat = lstatInRepo(root, repoPath);
  if (stat === null) return;
  if (!stat.isFile()) throw notRegular(repoPath);
  unlinkSync(resolveInRepo(root, repoPath));
}

function folderEntries(root: string, repoDir: string): Dirent[] | null {
  const stat = lstatInRepo(root, repoDir);
  if (stat === null) return null;
  if (!stat.isDirectory()) throw new Error(`Not a folder: ${repoDir}`);
  const entries = readdirSync(resolveInRepo(root, repoDir), { withFileTypes: true });
  const link = entries.find((e) => e.isSymbolicLink());
  if (link) throw new Error(`Symlinks are not allowed: ${repoDir}/${link.name}`);
  return entries;
}

/** Every regular file under a repo folder, as sorted repo paths; [] if the folder is missing. */
export function listRepoFiles(root: string, repoDir: string): string[] {
  return (folderEntries(root, repoDir) ?? []).flatMap((e) => {
    const path = `${repoDir}/${e.name}`;
    if (e.isDirectory()) return listRepoFiles(root, path);
    if (e.isFile()) return [path];
    throw notRegular(path);
  }).sort();
}

/** Names of the direct subfolders of a repo folder, sorted; [] if the folder is missing. */
export const listRepoFolders = (root: string, repoDir: string): string[] =>
  (folderEntries(root, repoDir) ?? []).filter((e) => e.isDirectory()).map((e) => e.name).sort();
