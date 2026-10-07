import { acceptanceCases } from './acceptance.js';
import { validateBaseline } from './baseline-file.js';
import { assertChangeExists, readRetires, ROW_ID } from './change.js';
import { loadConfig } from './config.js';
import { checkGate } from './gate-check.js';
import type { TestCase } from './junit.js';
import { rowOutcomes } from './outcomes.js';
import { changeRowIds, changeRows, liveRowIds, liveRows } from './spec-index.js';

export { rowOutcomes, type RowOutcome } from './outcomes.js';

export function requiredRows(root: string, id: string): string[] {
  const retired = readRetires(root, id);
  const all = new Set([...liveRowIds(root), ...changeRowIds(root, id)]);
  return [...all].filter((r) => !retired.has(r)).sort();
}

export function traceImplementation(required: readonly string[], cases: readonly TestCase[], scope?: string): { ok: boolean; problems: readonly string[] } {
  const where = scope === undefined ? '' : ` under ${scope}`;
  const problems = [...rowOutcomes(required, cases)]
    .filter(([, o]) => o !== 'passes')
    .map(([r, o]) => `${r}: ${o === 'not-run' ? `no executed test${where}` : 'failing'}`);
  return { ok: problems.length === 0, problems };
}

/** The acceptance folder from the approved test settings, or the problem that makes them untrustworthy. */
function approvedAcceptanceDir(root: string, id: string): { dir: string } | { problem: string } {
  try {
    validateBaseline(root, id);
    return { dir: loadConfig(root).test.acceptanceDir };
  } catch (e) {
    return { problem: (e as Error).message };
  }
}

/**
 * trace-check: the tests gate must be valid (it binds spec, design and retires.json) and the test
 * settings must match the baseline; then every required row must pass in a test under the acceptance folder.
 */
export function traceCheck(root: string, id: string, cases: readonly TestCase[]): readonly string[] {
  assertChangeExists(root, id);
  const tests = checkGate(root, id, 'tests');
  if (tests.status !== 'valid') return [`tests gate is ${tests.status}; retirements and rows are not approved`];
  const scope = approvedAcceptanceDir(root, id);
  if ('problem' in scope) return [scope.problem];
  const malformed = [...liveRows(root), ...changeRows(root, id)]
    .filter((r) => !ROW_ID.test(r.id))
    .map((r) => `Malformed row ID "${r.id}" in ${r.file}:${r.line}`);
  const scoped = acceptanceCases(root, scope.dir, cases);
  return [...malformed, ...scoped.problems, ...traceImplementation(requiredRows(root, id), scoped.cases, scope.dir).problems];
}
