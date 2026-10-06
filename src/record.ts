import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readJsonFile } from './change.js';
import { coveredFiles } from './coverage.js';
import { isObject } from './guards.js';
import { canonicalJson, sha256File } from './hash.js';
import { assertSafeRepoPath, changeDir, fromRepoPath, lstatOrNull } from './paths.js';
import { PREREQS, type ApprovalRecord, type Gate } from './types.js';
import { TOOL_VERSION } from './version.js';

const HEX64 = /^[0-9a-f]{64}$/;

export const recordPath = (root: string, id: string, gate: Gate): string =>
  join(changeDir(root, id), 'approvals', `${gate}.json`);

export function recordFileSha(root: string, id: string, gate: Gate): string | null {
  const path = recordPath(root, id, gate);
  const stat = lstatOrNull(path);
  if (stat === null) return null;
  if (stat.isSymbolicLink()) throw new Error(`docs/changes/${id}/approvals/${gate}.json: symlinks are not allowed`);
  return sha256File(path);
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
  const path = recordPath(root, id, gate);
  if (!existsSync(path)) return null;
  return parseRecord(readJsonFile(path, `docs/changes/${id}/approvals/${gate}.json`), id, gate);
}

export function buildRecord(root: string, id: string, gate: Gate): ApprovalRecord {
  const requires = PREREQS[gate].map((up) => {
    const sha = recordFileSha(root, id, up);
    if (sha === null) throw new Error(`Cannot build the ${gate} record: ${up} has no approval record`);
    return { gate: up, record_sha256: sha };
  });
  const covered = coveredFiles(root, id, gate).map((p) => ({ path: p, sha256: sha256File(fromRepoPath(root, p)) }));
  return Object.freeze({ change: id, gate, tool_version: TOOL_VERSION, requires, covered });
}

export function writeRecord(root: string, record: ApprovalRecord): string {
  const path = recordPath(root, record.change, record.gate);
  const approvalsDir = dirname(path);
  const approvalsDirStat = lstatOrNull(approvalsDir);
  if (approvalsDirStat !== null && approvalsDirStat.isSymbolicLink()) {
    throw new Error(`Symlinks are not allowed in gated folders: ${approvalsDir}`);
  }
  const recordStat = lstatOrNull(path);
  if (recordStat !== null && recordStat.isSymbolicLink()) {
    throw new Error(`Symlinks are not allowed in gated folders: ${path}`);
  }
  mkdirSync(approvalsDir, { recursive: true });
  writeFileSync(path, canonicalJson(record));
  return path;
}
