import { nonExempt, type ExemptPolicy } from './exempt.js';
import type { ChangedFile } from './git.js';
import { isChangeId } from './paths.js';
import { GATES, type Gate } from './types.js';

/** `rejected` always carries problems. `exempt` is the only kind that gets no wf checks. */
export type PrKind = 'gate' | 'change' | 'exempt' | 'rejected';

export interface Classification {
  readonly kind: PrKind;
  readonly change: string | null;
  readonly gate: Gate | null;
  readonly problems: readonly string[];
}

interface RecordRef {
  readonly change: string;
  readonly gate: Gate;
}

const RECORD = /^docs\/changes\/([^/]+)\/approvals\/([a-z]+)\.json$/;
const CHANGE_BRANCH = 'change/';
const MAX_LISTED = 10;

const done = (kind: PrKind, change: string | null, gate: Gate | null, problems: readonly string[]): Classification =>
  Object.freeze({ kind, change, gate, problems: Object.freeze([...new Set(problems)]) });

/** An approval record that was added, modified or type-changed. A deleted record is ignored (D6). */
function asRecord(file: ChangedFile): RecordRef | null {
  if (file.status !== 'A' && file.status !== 'M' && file.status !== 'T') return null;
  const m = RECORD.exec(file.path);
  const [change, gate] = [m?.[1], m?.[2]];
  if (change === undefined || gate === undefined || !isChangeId(change)) return null;
  const known = GATES.find((g) => g === gate);
  return known === undefined ? null : { change, gate: known };
}

function gateProblems(records: readonly RecordRef[], files: readonly ChangedFile[], headBranch: string): string[] {
  const [first] = records;
  if (first === undefined) return [];
  const id = first.change;
  const problems: string[] = [];
  if (records.length > 1) problems.push('more than one approval record in this PR (one gate per PR)');
  for (const other of new Set(records.map((r) => r.change))) {
    if (other !== id) problems.push(`approval record for a second change (${other})`);
  }
  const dir = `docs/changes/${id}/`;
  for (const file of files) {
    if (!file.path.startsWith(dir)) problems.push(`${file.path} is outside ${dir}`);
  }
  if (headBranch.startsWith(CHANGE_BRANCH) && headBranch.slice(CHANGE_BRANCH.length) !== id) {
    problems.push(`branch ${headBranch} does not match change ${id}`);
  }
  return problems;
}

function rejectedProblems(bad: readonly ChangedFile[]): string[] {
  const listed = bad.slice(0, MAX_LISTED).map((f) => `${f.path} is not exempt, and this PR is neither a gate PR nor on a change/<id> branch`);
  return bad.length > MAX_LISTED ? [...listed, `and ${bad.length - MAX_LISTED} more paths that are not exempt`] : listed;
}

/**
 * Classifies a PR from its changed files and head branch. Pure: both inputs are untrusted data.
 * The diff decides; the branch name can only add constraints, never grant a pass (D7).
 * `getPolicy` is called only when the PR is neither a gate PR nor on a `change/` branch, so it may throw.
 */
export function classifyPr(files: readonly ChangedFile[], headBranch: string, getPolicy: () => ExemptPolicy): Classification {
  const records = files.map(asRecord).filter((r): r is RecordRef => r !== null);
  const [first] = records;
  if (first !== undefined) return done('gate', first.change, first.gate, gateProblems(records, files, headBranch));
  if (headBranch.startsWith(CHANGE_BRANCH)) {
    const id = headBranch.slice(CHANGE_BRANCH.length);
    if (isChangeId(id)) return done('change', id, null, []);
    return done('rejected', null, null, [`branch ${headBranch} is not a valid change id`]);
  }
  const bad = nonExempt(files, getPolicy());
  if (bad.length === 0) return done('exempt', null, null, []);
  return done('rejected', null, null, rejectedProblems(bad));
}
