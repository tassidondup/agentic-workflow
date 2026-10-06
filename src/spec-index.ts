import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROW_ID } from './change.js';
import { changeDir, listFiles, lstatOrNull, toRepoPath } from './paths.js';
import { parseRows, type SpecRow } from './rows.js';

export function openChangeIds(root: string): string[] {
  const dir = join(root, 'docs', 'changes');
  const stat = lstatOrNull(dir);
  if (!stat) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== 'archive')
    .map((e) => e.name)
    .sort();
}

export function changeRows(root: string, id: string): SpecRow[] {
  const path = join(changeDir(root, id), 'spec-delta.md');
  const stat = lstatOrNull(path);
  if (stat === null) return [];
  if (stat.isSymbolicLink()) {
    throw new Error(`docs/changes/${id}/spec-delta.md: symlinks are not allowed`);
  }
  return parseRows(readFileSync(path, 'utf8'), toRepoPath(root, path));
}

export const changeRowIds = (root: string, id: string): string[] =>
  [...new Set(changeRows(root, id).map((r) => r.id).filter((r) => ROW_ID.test(r)))].sort();

export function liveRowIds(root: string): ReadonlySet<string> {
  const files = listFiles(join(root, 'docs', 'specs')).filter((f) => f.endsWith('.md'));
  const ids = files.flatMap((f) => parseRows(readFileSync(f, 'utf8'), toRepoPath(root, f)).map((r) => r.id));
  return new Set(ids.filter((r) => ROW_ID.test(r)).sort());
}
