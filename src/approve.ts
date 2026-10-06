import { validateBaseline } from './baseline-file.js';
import { readChange } from './change.js';
import { checkGate } from './gate-check.js';
import { buildRecord, writeRecord } from './record.js';
import { PREREQS, type ApprovalRecord, type Gate } from './types.js';

export function approve(root: string, id: string, gate: Gate): { record: ApprovalRecord; path: string } {
  for (const up of PREREQS[gate]) {
    const r = checkGate(root, id, up);
    if (r.status !== 'valid') {
      throw new Error(`Cannot approve ${gate}: the ${up} gate is ${r.status} (${r.problems.join('; ')}). Approve ${up} first.`);
    }
  }
  // Content checks the hashes can't express: a spec is only approvable if change.json parses.
  if (gate === 'spec') readChange(root, id);
  if (gate === 'tests') validateBaseline(root, id);
  const record = buildRecord(root, id, gate);
  return { record, path: writeRecord(root, record) };
}
