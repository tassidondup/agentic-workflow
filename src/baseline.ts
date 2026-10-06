import type { TestCase } from './junit.js';
import { rowOutcomes } from './trace.js';

export interface Baseline {
  readonly change: string;
  readonly rows: Readonly<Record<string, 'passes' | 'fails'>>;
  readonly flags: readonly string[];
}

export function computeBaseline(
  id: string,
  changeRowIds: readonly string[],
  live: ReadonlySet<string>,
  cases: readonly TestCase[],
  noBehaviourChange: boolean,
): { baseline: Baseline | null; problems: readonly string[] } {
  const outcomes = [...rowOutcomes(changeRowIds, cases)];
  const notRun = outcomes.filter(([, o]) => o === 'not-run').map(([r]) => `${r}: no executed test at baseline`);
  if (notRun.length > 0) return { baseline: null, problems: notRun };
  const rows = Object.fromEntries(outcomes) as Record<string, 'passes' | 'fails'>;
  const failing = Object.values(rows).filter((o) => o === 'fails').length;
  const problems = noBehaviourChange
    ? failing > 0 ? ['The change declares no behaviour change, but some rows fail at baseline'] : []
    : failing === 0 ? ['At least one row must fail at baseline, or declare "noBehaviourChange": true in change.json'] : [];
  if (problems.length > 0) return { baseline: null, problems };
  const flags = Object.entries(rows)
    .filter(([r, o]) => o === 'passes' && !live.has(r))
    .map(([r]) => `${r} is new in this change but already passes on main: weak test or existing behaviour. Decide before approving.`);
  return { baseline: Object.freeze({ change: id, rows, flags }), problems: [] };
}
