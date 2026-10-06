import { approve } from '../../src/approve.js';
import type { TestRepo } from './repo.js';

const ROWS = '| ID | x | Expected |\n|---|---|---|\n| LST-001 | 1 | 2 |\n';

/** Files for a change whose three gates can all be approved. */
export function changeFiles(id = 'c1', extra: Record<string, string> = {}): Record<string, string> {
  const c = `docs/changes/${id}`;
  return {
    [`${c}/proposal.md`]: 'p',
    [`${c}/spec-delta.md`]: ROWS,
    [`${c}/change.json`]: '{"level":"P1","noBehaviourChange":false}',
    [`${c}/design/design.md`]: 'd',
    [`${c}/tests/stage/tests/acceptance/a.test.ts`]: 't',
    [`${c}/baseline.json`]: '{}',
    ...extra,
  };
}

/** Approves spec, design and tests in order. */
export function approveAll(repo: TestRepo, id = 'c1'): void {
  approve(repo.root, id, 'spec');
  approve(repo.root, id, 'design');
  approve(repo.root, id, 'tests');
}
