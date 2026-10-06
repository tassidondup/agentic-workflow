import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { sha256File } from './hash.js';
import { changeDir, fromRepoPath, listFiles, lstatOrNull, toRepoPath } from './paths.js';
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

const stageRoot = (root: string, id: string, gate: StageGate): string => join(changeDir(root, id), gate, 'stage');

export function stagedFiles(root: string, id: string, gate: StageGate): StagedFile[] {
  const base = stageRoot(root, id, gate);
  return listFiles(base).map((abs) => {
    const livePath = toRepoPath(base, abs);
    if (FORBIDDEN.some((f) => livePath.toLowerCase().startsWith(f))) {
      throw new Error(`Staged file ${toRepoPath(root, abs)} may not target ${livePath}`);
    }
    return Object.freeze({ stagePath: toRepoPath(root, abs), livePath });
  });
}

// Checks every existing path component from the repo root down to and including
// `livePath` for a symlink, so writes/reads never traverse through one.
function assertNoSymlinkOnLivePath(root: string, livePath: string): void {
  const segments = livePath.split('/');
  let acc = root;
  for (const segment of segments) {
    acc = join(acc, segment);
    const stat = lstatOrNull(acc);
    if (stat?.isSymbolicLink()) {
      throw new Error(`Refusing to write through a symlink: ${toRepoPath(root, acc)}`);
    }
  }
}

export function checkStage(root: string, id: string, gate: StageGate): StageMismatch[] {
  return stagedFiles(root, id, gate).flatMap((f): StageMismatch[] => {
    assertNoSymlinkOnLivePath(root, f.livePath);
    const live = fromRepoPath(root, f.livePath);
    if (!existsSync(live)) return [{ livePath: f.livePath, reason: 'missing' }];
    return sha256File(live) === sha256File(fromRepoPath(root, f.stagePath)) ? [] : [{ livePath: f.livePath, reason: 'different' }];
  });
}

export function promote(root: string, id: string, gate: StageGate): string[] {
  const files = stagedFiles(root, id, gate);
  files.forEach((f) => assertNoSymlinkOnLivePath(root, f.livePath));
  files.forEach((f) => {
    const live = fromRepoPath(root, f.livePath);
    mkdirSync(dirname(live), { recursive: true });
    copyFileSync(fromRepoPath(root, f.stagePath), live);
  });
  return files.map((f) => f.livePath);
}
