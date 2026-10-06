import { coveredFiles } from './coverage.js';
import { readRecord, recordFileSha } from './record.js';
import { hashRepoFile, lstatInRepo } from './safe-fs.js';
import { GATES, type ApprovalRecord, type Gate, type GateResult } from './types.js';

const result = (gate: Gate, status: GateResult['status'], problems: readonly string[]): GateResult =>
  Object.freeze({ gate, status, problems: Object.freeze([...new Set(problems)]) });

function ownChanges(root: string, id: string, gate: Gate, record: ApprovalRecord): string[] {
  const fromRecord = record.covered.flatMap((c) => {
    try {
      if (lstatInRepo(root, c.path) === null) return [`${c.path} was deleted`];
      return hashRepoFile(root, c.path) === c.sha256 ? [] : [`${c.path} changed`];
    } catch (e) {
      return [(e as Error).message];
    }
  });
  let current: string[];
  try {
    current = coveredFiles(root, id, gate);
  } catch (e) {
    return [...fromRecord, (e as Error).message];
  }
  const approved = new Set(record.covered.map((c) => c.path));
  const added = current.filter((p) => !approved.has(p)).map((p) => `${p} was added after approval`);
  return [...fromRecord, ...added];
}

export function checkGate(root: string, id: string, gate: Gate): GateResult {
  let record: ApprovalRecord | null;
  try {
    record = readRecord(root, id, gate);
  } catch (e) {
    return result(gate, 'missing', [(e as Error).message]);
  }
  if (record === null) return result(gate, 'missing', [`No approval record for the ${gate} gate`]);
  const changed = ownChanges(root, id, gate, record);
  if (changed.length > 0) return result(gate, 'changed', changed);
  for (const req of record.requires) {
    const upstream = checkGate(root, id, req.gate);
    if (upstream.status !== 'valid') return result(gate, 'blocked', [`the ${req.gate} gate is ${upstream.status}`]);
  }
  const stale = record.requires
    .filter((req) => recordFileSha(root, id, req.gate) !== req.record_sha256)
    .map((req) => `approved against an older ${req.gate} record; re-approve ${gate}`);
  return stale.length > 0 ? result(gate, 'stale', stale) : result(gate, 'valid', []);
}

export const checkAll = (root: string, id: string): GateResult[] => GATES.map((g) => checkGate(root, id, g));
