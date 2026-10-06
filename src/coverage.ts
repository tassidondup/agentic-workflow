import { changeRepoDir } from './paths.js';
import { listRepoFiles, lstatInRepo } from './safe-fs.js';
import type { Gate } from './types.js';

const REQUIRED: Readonly<Record<Gate, readonly string[]>> = {
  spec: ['proposal.md', 'spec-delta.md', 'change.json'],
  design: ['design/design.md'],
  tests: ['baseline.json'],
};
const OPTIONAL: Readonly<Record<Gate, readonly string[]>> = { spec: [], design: [], tests: ['retires.json'] };
const FOLDERS: Readonly<Record<Gate, readonly string[]>> = { spec: [], design: ['design'], tests: ['tests'] };

/** True if a named file exists as a regular file; throws on symlinks and special files. */
function present(root: string, repoPath: string): boolean {
  const stat = lstatInRepo(root, repoPath);
  if (stat === null) return false;
  if (!stat.isFile()) throw new Error(`Not a regular file: ${repoPath}`);
  return true;
}

/** Repo paths of every file the gate covers, sorted. */
export function coveredFiles(root: string, id: string, gate: Gate): string[] {
  const dir = changeRepoDir(id);
  const named = [...REQUIRED[gate], ...OPTIONAL[gate]].filter((f) => present(root, `${dir}/${f}`));
  const missing = REQUIRED[gate].filter((f) => !named.includes(f));
  if (missing.length > 0) throw new Error(`${gate} gate for ${id} is missing: ${missing.join(', ')}`);
  const inFolders = FOLDERS[gate].flatMap((f) => listRepoFiles(root, `${dir}/${f}`));
  return [...new Set([...named.map((f) => `${dir}/${f}`), ...inFolders])].sort();
}

/** True if `repoPath` is a file the gate could cover (named file or inside a gated folder). Pure: no disk access. */
export function inGateScope(id: string, gate: Gate, repoPath: string): boolean {
  const dir = changeRepoDir(id);
  return [...REQUIRED[gate], ...OPTIONAL[gate]].some((f) => repoPath === `${dir}/${f}`) ||
    FOLDERS[gate].some((f) => repoPath.startsWith(`${dir}/${f}/`));
}
