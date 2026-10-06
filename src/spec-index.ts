import { ROW_ID } from './change.js';
import { changeRepoDir } from './paths.js';
import { parseRows, type SpecRow } from './rows.js';
import { listRepoFiles, listRepoFolders, lstatInRepo, readRepoFile } from './safe-fs.js';

export function openChangeIds(root: string): string[] {
  return listRepoFolders(root, 'docs/changes').filter((name) => name !== 'archive');
}

export function changeRows(root: string, id: string): SpecRow[] {
  const path = `${changeRepoDir(id)}/spec-delta.md`;
  if (lstatInRepo(root, path) === null) return [];
  return parseRows(readRepoFile(root, path, 'utf8'), path);
}

export const changeRowIds = (root: string, id: string): string[] =>
  [...new Set(changeRows(root, id).map((r) => r.id).filter((r) => ROW_ID.test(r)))].sort();

/** Every row in docs/specs/**.md, including rows whose ID is malformed. */
export function liveRows(root: string): SpecRow[] {
  const files = listRepoFiles(root, 'docs/specs').filter((f) => f.endsWith('.md'));
  return files.flatMap((f) => parseRows(readRepoFile(root, f, 'utf8'), f));
}

export const liveRowIds = (root: string): ReadonlySet<string> =>
  new Set(liveRows(root).map((r) => r.id).filter((r) => ROW_ID.test(r)).sort());
