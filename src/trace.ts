import { readRetires } from './change.js';
import type { TestCase } from './junit.js';
import { changeRowIds, liveRowIds } from './spec-index.js';

export type RowOutcome = 'passes' | 'fails' | 'not-run';

export function rowOutcomes(rowIds: readonly string[], cases: readonly TestCase[]): ReadonlyMap<string, RowOutcome> {
  return new Map(
    rowIds.map((id): [string, RowOutcome] => {
      const executed = cases.filter((c) => c.rowIds.includes(id) && c.status !== 'skipped');
      if (executed.length === 0) return [id, 'not-run'];
      return [id, executed.every((c) => c.status === 'passed') ? 'passes' : 'fails'];
    }),
  );
}

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
