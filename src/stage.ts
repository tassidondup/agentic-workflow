import { validateBaseline } from './baseline-file.js';
import { assertChangeExists, readRetires } from './change.js';
import { loadConfig } from './config.js';
import { checkGate } from './gate-check.js';
import { manifestProblems } from './manifest.js';
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

// Characters HFS+ ignores in names (zero-width joiners, direction marks, BOM), so `.g‌it` is `.git`.
const HFS_IGNORABLE = /[​-‏‪-‮⁠-⁤⁪-⁯﻿]/g;

// What a filesystem may resolve a segment to: case-folded, HFS+ ignorables removed, and NTFS
// trailing dots/spaces stripped (`.git.` and `.git ` are `.git`). `git~1` is .git's 8.3 short name.
function canonicalSegment(segment: string): string {
  const s = segment.toLowerCase().replace(HFS_IGNORABLE, '').replace(/[. ]+$/, '');
  return s === 'git~1' ? '.git' : s;
}

// Compared by canonical segment, so case-insensitive and alias names can't reach a protected folder.
function isForbiddenTarget(livePath: string): boolean {
  const [first, second, ...rest] = livePath.split('/').map(canonicalSegment);
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
  files.forEach((f) => {
    const mode = (lstatInRepo(root, f.stagePath)?.mode ?? 0o644) & 0o777;
    writeRepoFile(root, f.livePath, readRepoFile(root, f.stagePath), mode);
  });
  return files.map((f) => f.livePath);
}

// Re-validating baseline.json catches test settings changed after the gate (inputs_sha256); the
// manifest check catches decoys, edits and unretired deletions in the acceptance folder and harness.
function acceptanceProblems(root: string, id: string): string[] {
  try {
    const manifest = validateBaseline(root, id);
    const staged = new Set(STAGE_GATES.flatMap((g) => stagedFiles(root, id, g).map((f) => f.livePath)));
    return manifestProblems(root, loadConfig(root), manifest, { staged, retired: readRetires(root, id) });
  } catch (e) {
    return [(e as Error).message];
  }
}

/**
 * stage-check: the design and tests gates must always be valid (so deleting staging after
 * approval can't hide a loosened live file), live files must equal their staged bytes, and
 * (once the tests gate is valid) the acceptance folder and harness must match the baseline manifest.
 */
export function stageCheck(root: string, id: string): string[] {
  assertChangeExists(root, id);
  const gates = STAGE_GATES.map((g) => ({ g, status: checkGate(root, id, g).status }));
  const problems = gates.flatMap(({ g, status }) => {
    const invalid = status === 'valid' ? [] : [`${g} gate is ${status}`];
    const mismatches = checkStage(root, id, g).map((m) => `${g}: ${m.livePath} is ${m.reason === 'missing' ? 'missing' : 'different from approved staging'}`);
    return [...invalid, ...mismatches];
  });
  const testsValid = gates.some(({ g, status }) => g === 'tests' && status === 'valid');
  return [...problems, ...(testsValid ? acceptanceProblems(root, id) : [])];
}
