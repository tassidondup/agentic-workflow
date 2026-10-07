import { approve } from '../../src/approve.js';
import { baselineInputs } from '../../src/baseline-file.js';
import { loadConfig } from '../../src/config.js';
import { buildManifest } from '../../src/manifest.js';
import { changeRowIds } from '../../src/spec-index.js';
import type { TestRepo } from './repo.js';

/** A valid workflow.config.json for fixtures: acceptance tests live in tests/acceptance, no harness files. */
export const CONFIG = JSON.stringify({
  approvers: ['tassi'],
  test: { command: ['node', '-e', '0'], junitReport: 'reports/junit.xml', acceptanceDir: 'tests/acceptance', harness: [] },
});

const ROWS = '| ID | x | Expected |\n|---|---|---|\n| LST-001 | 1 | 2 |\n';

/** Files for a change whose three gates can all be approved. */
export function changeFiles(id = 'c1', extra: Record<string, string> = {}): Record<string, string> {
  const c = `docs/changes/${id}`;
  return {
    'workflow.config.json': CONFIG,
    [`${c}/proposal.md`]: 'p',
    [`${c}/spec-delta.md`]: ROWS,
    [`${c}/change.json`]: '{"level":"P1","noBehaviourChange":false}',
    [`${c}/design/design.md`]: 'd',
    [`${c}/tests/stage/tests/acceptance/a.test.ts`]: 't',
    ...extra,
  };
}

/** Writes a baseline.json that matches the current inputs, with every row failing. */
export function writeValidBaseline(repo: TestRepo, id = 'c1'): void {
  const rows = Object.fromEntries(changeRowIds(repo.root, id).map((r) => [r, 'fails']));
  const body = { change: id, rows, flags: [], inputs_sha256: baselineInputs(repo.root, id), ...buildManifest(repo.root, loadConfig(repo.root)) };
  repo.write(`docs/changes/${id}/baseline.json`, JSON.stringify(body));
}

/** Approves spec, design and tests in order (writing a matching baseline.json first). */
export function approveAll(repo: TestRepo, id = 'c1'): void {
  approve(repo.root, id, 'spec');
  approve(repo.root, id, 'design');
  writeValidBaseline(repo, id);
  approve(repo.root, id, 'tests');
}
