import { join } from 'node:path';
import { readJsonFile } from './change.js';
import { coveredFiles } from './coverage.js';
import { isObject } from './guards.js';
import { canonicalJson, HEX64 } from './hash.js';
import { assertSafeRepoPath, changeDir, changeRepoDir } from './paths.js';
import { hashRepoFile, lstatInRepo, writeRepoFile } from './safe-fs.js';
import { PREREQS, type ApprovalRecord, type Gate } from './types.js';
import { TOOL_VERSION } from './version.js';


export const recordPath = (root: string, id: string, gate: Gate): string =>
  join(changeDir(root, id), 'approvals', `${gate}.json`);

export const recordRepoPath = (id: string, gate: Gate): string => `${changeRepoDir(id)}/approvals/${gate}.json`;

export function recordFileSha(root: string, id: string, gate: Gate): string | null {
  const path = recordRepoPath(id, gate);
  return lstatInRepo(root, path) === null ? null : hashRepoFile(root, path);
}

export function parseRecord(raw: unknown, id: string, gate: Gate): ApprovalRecord {
  const label = `docs/changes/${id}/approvals/${gate}.json`;
  const bad = (msg: string): never => {
    throw new Error(`${label}: ${msg}`);
  };
  if (!isObject(raw)) return bad('must be a JSON object');
  if (raw.change !== id) bad(`"change" must be "${id}"`);
  if (raw.gate !== gate) bad(`"gate" must be "${gate}"`);
  if (typeof raw.tool_version !== 'string') bad('"tool_version" must be a string');
  const requires = Array.isArray(raw.requires) ? raw.requires : bad('"requires" must be a list');
  const expected = PREREQS[gate];
  const reqOk =
    requires.length === expected.length &&
    requires.every((r, i) => isObject(r) && r.gate === expected[i] && typeof r.record_sha256 === 'string' && HEX64.test(r.record_sha256));
  if (!reqOk) bad(`"requires" must list exactly [${expected.join(', ')}] with sha256 hashes`);
  const covered = Array.isArray(raw.covered) ? raw.covered : bad('"covered" must be a list');
  covered.forEach((c) => {
    if (!isObject(c) || typeof c.path !== 'string' || typeof c.sha256 !== 'string' || !HEX64.test(c.sha256)) {
      bad('every "covered" entry needs a path and a sha256 hash');
    }
    try {
      assertSafeRepoPath(c.path as string);
    } catch (e) {
      bad((e as Error).message);
    }
  });
  return Object.freeze(raw as unknown as ApprovalRecord);
}

export function readRecord(root: string, id: string, gate: Gate): ApprovalRecord | null {
  const path = recordRepoPath(id, gate);
  if (lstatInRepo(root, path) === null) return null;
  return parseRecord(readJsonFile(root, path), id, gate);
}

export function buildRecord(root: string, id: string, gate: Gate): ApprovalRecord {
  const requires = PREREQS[gate].map((up) => {
    const sha = recordFileSha(root, id, up);
    if (sha === null) throw new Error(`Cannot build the ${gate} record: ${up} has no approval record`);
    return { gate: up, record_sha256: sha };
  });
  const covered = coveredFiles(root, id, gate).map((p) => ({ path: p, sha256: hashRepoFile(root, p) }));
  return Object.freeze({ change: id, gate, tool_version: TOOL_VERSION, requires, covered });
}

export function writeRecord(root: string, record: ApprovalRecord): string {
  writeRepoFile(root, recordRepoPath(record.change, record.gate), canonicalJson(record));
  return recordPath(root, record.change, record.gate);
}
