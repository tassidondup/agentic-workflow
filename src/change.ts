import { isObject } from './guards.js';
import { changeRepoDir } from './paths.js';
import { lstatInRepo, readRepoFile } from './safe-fs.js';

export const ROW_ID = /^[A-Z][A-Z0-9]{1,9}-\d{1,4}$/;
export type Level = 'P0' | 'P1' | 'P2' | 'P3' | 'P4';
const LEVELS: readonly string[] = ['P0', 'P1', 'P2', 'P3', 'P4'];

export interface ChangeMeta {
  readonly level: Level;
  readonly noBehaviourChange: boolean;
}

/** Reads and parses a JSON file inside the repo; errors are prefixed with `label`. */
export function readJsonFile(root: string, repoPath: string, label: string = repoPath): unknown {
  let text: string;
  try {
    text = readRepoFile(root, repoPath, 'utf8');
  } catch (e) {
    throw new Error(`${label}: cannot read file (${(e as Error).message})`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`${label}: invalid JSON (${(e as Error).message})`);
  }
}

export function readChange(root: string, id: string): ChangeMeta {
  const label = `${changeRepoDir(id)}/change.json`;
  const raw = readJsonFile(root, label);
  if (!isObject(raw) || typeof raw.level !== 'string' || !LEVELS.includes(raw.level)) {
    throw new Error(`${label}: "level" must be one of ${LEVELS.join(', ')}`);
  }
  if (typeof raw.noBehaviourChange !== 'boolean') {
    throw new Error(`${label}: "noBehaviourChange" must be true or false`);
  }
  return Object.freeze({ level: raw.level as Level, noBehaviourChange: raw.noBehaviourChange });
}

export function readRetires(root: string, id: string): ReadonlySet<string> {
  const label = `${changeRepoDir(id)}/retires.json`;
  if (lstatInRepo(root, label) === null) return new Set();
  const raw = readJsonFile(root, label);
  if (!Array.isArray(raw) || !raw.every((r) => typeof r === 'string' && ROW_ID.test(r))) {
    throw new Error(`${label}: must be a JSON array of row IDs like "LST-004"`);
  }
  return new Set(raw as string[]);
}
