import { assertChangeExists } from './change.js';
import { checkGate } from './gate-check.js';
import { changeRepoDir } from './paths.js';
import { hashRepoFile, listRepoFiles, lstatInRepo, readRepoFile, writeRepoFile } from './safe-fs.js';
import { STAGE_GATES, type StageGate } from './types.js';

export interface StagedFile {
  readonly stagePath: string;
  readonly livePath: string;
}

export interface StageMismatch {
  readonly livePath: string;
  readonly reason: 'missing' | 'different';
}

const FORBIDDEN_TOP = ['.git', '.github', '.workflow'];

// Compared by segment, case-insensitively: case-insensitive filesystems treat `.GIT` as `.git`.
function isForbiddenTarget(livePath: string): boolean {
  const [first, second, ...rest] = livePath.toLowerCase().split('/');
  return FORBIDDEN_TOP.includes(first ?? '') ||
    (first === 'docs' && second === 'changes') ||
    [second, ...rest].includes('.git');
}

const stageRoot = (id: string, gate: StageGate): string => `${changeRepoDir(id)}/${gate}/stage`;

export function stagedFiles(root: string, id: string, gate: StageGate): StagedFile[] {
  const base = stageRoot(id, gate);
  return listRepoFiles(root, base).map((stagePath) => {
    const livePath = stagePath.slice(base.length + 1);
    if (isForbiddenTarget(livePath)) {
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

/** stage-check: every gate with staged files must be valid, and live files must equal its staged bytes. */
export function stageCheck(root: string, id: string): string[] {
  assertChangeExists(root, id);
  return STAGE_GATES.flatMap((g) => {
    if (stagedFiles(root, id, g).length === 0) return [];
    const gate = checkGate(root, id, g);
    const invalid = gate.status === 'valid' ? [] : [`${g} gate is ${gate.status}`];
    const mismatches = checkStage(root, id, g).map((m) => `${g}: ${m.livePath} is ${m.reason === 'missing' ? 'missing' : 'different from approved staging'}`);
    return [...invalid, ...mismatches];
  });
}
