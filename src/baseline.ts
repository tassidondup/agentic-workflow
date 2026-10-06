import type { TestCase } from './junit.js';
import { rowOutcomes } from './trace.js';

export interface Baseline {
  readonly change: string;
  readonly rows: Readonly<Record<string, 'passes' | 'fails'>>;
  readonly flags: readonly string[];
  readonly inputs_sha256: string;
}

export interface BaselineInput {
  readonly id: string;
  readonly changeRowIds: readonly string[];
  readonly retired: ReadonlySet<string>;
  readonly live: ReadonlySet<string>;
  readonly cases: readonly TestCase[];
  readonly noBehaviourChange: boolean;
  readonly inputsSha256: string;
}

export const behaviourProblems = (failing: number, noBehaviourChange: boolean): string[] => {
  if (noBehaviourChange) return failing > 0 ? ['The change declares no behaviour change, but some rows fail at baseline'] : [];
  return failing === 0 ? ['At least one row must fail at baseline, or declare "noBehaviourChange": true in change.json'] : [];
};

export function computeBaseline(input: BaselineInput): { baseline: Baseline | null; problems: readonly string[] } {
  const rowIds = input.changeRowIds.filter((r) => !input.retired.has(r));
  const outcomes = [...rowOutcomes(rowIds, input.cases)];
  const notRun = outcomes.filter(([, o]) => o === 'not-run').map(([r]) => `${r}: no executed test at baseline`);
  if (notRun.length > 0) return { baseline: null, problems: notRun };
  const rows = Object.fromEntries(outcomes) as Record<string, 'passes' | 'fails'>;
  const problems = behaviourProblems(Object.values(rows).filter((o) => o === 'fails').length, input.noBehaviourChange);
  if (problems.length > 0) return { baseline: null, problems };
  const flags = Object.entries(rows)
    .filter(([r, o]) => o === 'passes' && !input.live.has(r))
    .map(([r]) => `${r} is new in this change but already passes on main: weak test or existing behaviour. Decide before approving.`);
  return { baseline: Object.freeze({ change: input.id, rows, flags, inputs_sha256: input.inputsSha256 }), problems: [] };
}
