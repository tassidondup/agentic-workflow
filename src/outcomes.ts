import type { TestCase } from './junit.js';

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
