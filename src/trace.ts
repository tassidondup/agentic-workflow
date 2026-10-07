import { assertChangeExists, readRetires, ROW_ID } from './change.js';
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

export function traceImplementation(required: readonly string[], cases: readonly TestCase[]): { ok: boolean; problems: readonly string[] } {
  const problems = [...rowOutcomes(required, cases)]
    .filter(([, o]) => o !== 'passes')
    .map(([r, o]) => `${r}: ${o === 'not-run' ? 'no executed test' : 'failing'}`);
  return { ok: problems.length === 0, problems };
}

/** trace-check: the tests gate must be valid (it binds spec, design and retires.json), then every required row must pass. */
export function traceCheck(root: string, id: string, cases: readonly TestCase[]): readonly string[] {
  assertChangeExists(root, id);
  const tests = checkGate(root, id, 'tests');
  if (tests.status !== 'valid') return [`tests gate is ${tests.status}; retirements and rows are not approved`];
  const malformed = [...liveRows(root), ...changeRows(root, id)]
    .filter((r) => !ROW_ID.test(r.id))
    .map((r) => `Malformed row ID "${r.id}" in ${r.file}:${r.line}`);
  return [...malformed, ...traceImplementation(requiredRows(root, id), cases).problems];
}
