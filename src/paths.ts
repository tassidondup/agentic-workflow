import { isAbsolute, join, posix, relative, sep } from 'node:path';

const CHANGE_ID = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/;

export const isChangeId = (id: string): boolean => CHANGE_ID.test(id);

export function assertChangeId(id: string): string {
  if (!isChangeId(id)) {
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

/** Repo path of a change folder, e.g. `docs/changes/<id>`. */
export const changeRepoDir = (id: string): string => `docs/changes/${assertChangeId(id)}`;
