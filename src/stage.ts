import { changeRepoDir } from './paths.js';
import { hashRepoFile, listRepoFiles, lstatInRepo, readRepoFile, writeRepoFile } from './safe-fs.js';
import type { StageGate } from './types.js';

export interface StagedFile {
  readonly stagePath: string;
  readonly livePath: string;
}

export interface StageMismatch {
  readonly livePath: string;
  readonly reason: 'missing' | 'different';
}

const FORBIDDEN = ['docs/changes/', '.git/', '.github/', '.workflow/'];

const stageRoot = (id: string, gate: StageGate): string => `${changeRepoDir(id)}/${gate}/stage`;

export function stagedFiles(root: string, id: string, gate: StageGate): StagedFile[] {
  const base = stageRoot(id, gate);
  return listRepoFiles(root, base).map((stagePath) => {
    const livePath = stagePath.slice(base.length + 1);
    if (FORBIDDEN.some((f) => livePath.toLowerCase().startsWith(f))) {
      throw new Error(`Staged file ${stagePath} may not target ${livePath}`);
    }
    return Object.freeze({ stagePath, livePath });
  });
}

/** Throws if the live path runs through a symlink or exists as something other than a regular file. */
function assertWritableLive(root: string, livePath: string): void {
  const stat = lstatInRepo(root, livePath);
  if (stat !== null && !stat.isFile()) throw new Error(`Not a regular file: ${livePath}`);
}

export function checkStage(root: string, id: string, gate: StageGate): StageMismatch[] {
  return stagedFiles(root, id, gate).flatMap((f): StageMismatch[] => {
    if (lstatInRepo(root, f.livePath) === null) return [{ livePath: f.livePath, reason: 'missing' }];
    return hashRepoFile(root, f.livePath) === hashRepoFile(root, f.stagePath) ? [] : [{ livePath: f.livePath, reason: 'different' }];
  });
}

export function promote(root: string, id: string, gate: StageGate): string[] {
  const files = stagedFiles(root, id, gate);
  files.forEach((f) => assertWritableLive(root, f.livePath));
  files.forEach((f) => writeRepoFile(root, f.livePath, readRepoFile(root, f.stagePath)));
  return files.map((f) => f.livePath);
}
