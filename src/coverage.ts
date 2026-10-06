import { existsSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { changeDir, listFiles, toRepoPath } from './paths.js';
import type { Gate } from './types.js';

const REQUIRED: Readonly<Record<Gate, readonly string[]>> = {
  spec: ['proposal.md', 'spec-delta.md', 'change.json'],
  design: ['design/design.md'],
  tests: ['baseline.json'],
};
const OPTIONAL: Readonly<Record<Gate, readonly string[]>> = { spec: [], design: [], tests: ['retires.json'] };
const FOLDERS: Readonly<Record<Gate, readonly string[]>> = { spec: [], design: ['design'], tests: ['tests'] };

const abs = (dir: string, rel: string): string => join(dir, ...rel.split('/'));

function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

function refuseSymlink(path: string): void {
  if (isSymlink(path)) throw new Error(`Symlinks are not allowed in gated folders: ${path}`);
}

export function coveredFiles(root: string, id: string, gate: Gate): string[] {
  const dir = changeDir(root, id);
  refuseSymlink(dir);
  const namedFiles = [...REQUIRED[gate], ...OPTIONAL[gate]].map((f) => abs(dir, f));
  namedFiles.forEach(refuseSymlink);
  const missing = REQUIRED[gate].filter((f) => !existsSync(abs(dir, f)));
  if (missing.length > 0) throw new Error(`${gate} gate for ${id} is missing: ${missing.join(', ')}`);
  const present = [...REQUIRED[gate], ...OPTIONAL[gate].filter((f) => existsSync(abs(dir, f)))].map((f) => abs(dir, f));
  const inFolders = FOLDERS[gate].flatMap((f) => listFiles(abs(dir, f)));
  return [...new Set([...present, ...inFolders].map((a) => toRepoPath(root, a)))].sort();
}
