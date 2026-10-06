import { lstatSync, readdirSync, type Stats } from 'node:fs';
import { isAbsolute, join, posix, relative, sep } from 'node:path';

const CHANGE_ID = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/;

export function assertChangeId(id: string): string {
  if (!CHANGE_ID.test(id)) {
    throw new Error(`Invalid change id "${id}". Use lowercase letters, digits and dashes (2-64 chars).`);
  }
  return id;
}

export function assertSafeRepoPath(repoPath: string): string {
  const parts = repoPath.split('/');
  const unsafe =
    repoPath === '' ||
    repoPath.startsWith('/') ||
    repoPath.includes('\\') ||
    /^[A-Za-z]:/.test(repoPath) ||
    parts.some((p) => p === '' || p === '.' || p === '..');
  if (unsafe) throw new Error(`Unsafe repository path: "${repoPath}"`);
  return repoPath;
}

export const fromRepoPath = (root: string, repoPath: string): string =>
  join(root, ...assertSafeRepoPath(repoPath).split('/'));

export function toRepoPath(root: string, absPath: string): string {
  const rel = relative(root, absPath);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`Path is outside the repository: ${absPath}`);
  }
  return rel.split(sep).join(posix.sep);
}

export const changeDir = (root: string, id: string): string =>
  join(root, 'docs', 'changes', assertChangeId(id));

function lstatOrNull(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

export function listFiles(absDir: string): string[] {
  const stat = lstatOrNull(absDir);
  if (!stat) return [];
  if (stat.isSymbolicLink()) throw new Error(`Symlinks are not allowed in gated folders: ${absDir}`);
  if (!stat.isDirectory()) throw new Error(`Expected a folder: ${absDir}`);
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Symlinks are not allowed in gated folders: ${abs}`);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile()) found.push(abs);
    }
  };
  walk(absDir);
  return found.sort();
}
