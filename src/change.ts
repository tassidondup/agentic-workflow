import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isObject } from './guards.js';
import { changeDir } from './paths.js';

export const ROW_ID = /^[A-Z][A-Z0-9]{1,9}-\d{1,4}$/;
export type Level = 'P0' | 'P1' | 'P2' | 'P3' | 'P4';
const LEVELS: readonly string[] = ['P0', 'P1', 'P2', 'P3', 'P4'];

export interface ChangeMeta {
  readonly level: Level;
  readonly noBehaviourChange: boolean;
}

export function readJsonFile(absPath: string, label: string): unknown {
  let text: string;
  try {
    const stat = lstatSync(absPath);
    if (stat.isSymbolicLink()) {
      throw new Error(`${label}: symlinks are not allowed`);
    }
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      throw new Error(`${label}: cannot read file (ENOENT: no such file or directory, lstat '${absPath}')`);
    }
    throw e;
  }
  try {
    text = readFileSync(absPath, 'utf8');
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
  const label = `docs/changes/${id}/change.json`;
  const raw = readJsonFile(join(changeDir(root, id), 'change.json'), label);
  if (!isObject(raw) || typeof raw.level !== 'string' || !LEVELS.includes(raw.level)) {
    throw new Error(`${label}: "level" must be one of ${LEVELS.join(', ')}`);
  }
  if (typeof raw.noBehaviourChange !== 'boolean') {
    throw new Error(`${label}: "noBehaviourChange" must be true or false`);
  }
  return Object.freeze({ level: raw.level as Level, noBehaviourChange: raw.noBehaviourChange });
}

export function readRetires(root: string, id: string): ReadonlySet<string> {
  const path = join(changeDir(root, id), 'retires.json');
  try {
    lstatSync(path);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') return new Set();
    throw e;
  }
  const label = `docs/changes/${id}/retires.json`;
  const raw = readJsonFile(path, label);
  if (!Array.isArray(raw) || !raw.every((r) => typeof r === 'string' && ROW_ID.test(r))) {
    throw new Error(`${label}: must be a JSON array of row IDs like "LST-004"`);
  }
  return new Set(raw as string[]);
}
