import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { run } from '../src/cli.js';
import { git, makeRepo, type TestRepo } from './helpers/repo.js';

let repo: TestRepo;
afterEach(() => repo?.cleanup());
const C = 'docs/changes/listing-price-limits';
const runner = resolve('test/helpers/fake-runner.mjs');

function wf(...argv: string[]): { code: number; out: string } {
  const out: string[] = [];
  const code = run(argv, { out: (s) => out.push(s), err: (s) => out.push(s), cwd: repo.root });
  return { code, out: out.join('\n') };
}
const commit = (msg: string): void => {
  git(repo.root, 'add', '.');
  git(repo.root, 'commit', '-q', '-m', msg);
};

describe('full change lifecycle', () => {
  it('gates, stages, baselines and traces a change; catches tampering', () => {
    repo = makeRepo({
      'workflow.config.json': JSON.stringify({ approvers: ['tassi'], test: { command: ['node', runner], junitReport: 'reports/junit.xml', acceptanceDir: 'tests/acceptance', harness: [] } }),
      'docs/context.md': '# Context\n', 'docs/glossary.md': '# Glossary\n',
      'docs/specs/listing/spec.md': '| ID | Price | Expected |\n|---|---|---|\n| LST-001 | 999999 | 201 |\n',
      [`${C}/proposal.md`]: 'Limit prices.',
      [`${C}/change.json`]: '{"level":"P1","noBehaviourChange":false}',
      [`${C}/spec-delta.md`]: '| ID | Price | Expected |\n|---|---|---|\n| LST-002 | 0 | 422 |\n| LST-003 | 1000001 | 422 |\n',
    });
    git(repo.root, 'init', '-q', '-b', 'main');
    commit('init');

    expect(wf('spec-lint', 'listing-price-limits').code).toBe(0);
    expect(wf('approve', 'listing-price-limits', 'spec').code).toBe(0);

    repo.write(`${C}/design/design.md`, 'Validate price in the API.');
    repo.write(`${C}/design/stage/packages/contracts/openapi.yaml`, 'price: { type: integer, minimum: 1, maximum: 1000000 }\n');
    expect(wf('approve', 'listing-price-limits', 'design').code).toBe(0);

    repo.write(`${C}/tests/stage/tests/acceptance/rows.json`, JSON.stringify({ rows: [
      { id: 'LST-001', title: 'accepts max', existing: true },
      { id: 'LST-002', title: 'rejects 0' },
      { id: 'LST-003', title: 'rejects over limit' },
    ] }));
    commit('stage tests');
    const b = wf('baseline', 'listing-price-limits');
    expect(b.code).toBe(0);
    expect(b.out).toMatch(/LST-002 fails/);
    expect(wf('approve', 'listing-price-limits', 'tests').code).toBe(0);
    expect(wf('gate-check', 'listing-price-limits').code).toBe(0);

    // Edit the design after approval: design changed, tests blocked; re-approving design makes tests stale.
    repo.write(`${C}/design/design.md`, 'Validate price in the API and the UI.');
    expect(wf('gate-check', 'listing-price-limits').out).toMatch(/spec\s+valid[\s\S]*design\s+changed[\s\S]*tests\s+blocked/);
    expect(wf('approve', 'listing-price-limits', 'design').code).toBe(0);
    expect(wf('gate-check', 'listing-price-limits').out).toMatch(/design\s+valid[\s\S]*tests\s+stale/);
    expect(wf('approve', 'listing-price-limits', 'tests').code).toBe(0);
    expect(wf('gate-check', 'listing-price-limits').code).toBe(0);

    // Edit the spec after approval: spec changed, everything downstream blocked.
    repo.write(`${C}/proposal.md`, 'Limit prices (edited).');
    expect(wf('gate-check', 'listing-price-limits').out).toMatch(/spec\s+changed[\s\S]*design\s+blocked[\s\S]*tests\s+blocked/);
    expect(wf('approve', 'listing-price-limits', 'spec').code).toBe(0);
    expect(wf('gate-check', 'listing-price-limits').out).toMatch(/design\s+stale[\s\S]*tests\s+blocked/);
    expect(wf('approve', 'listing-price-limits', 'design').code).toBe(0);
    expect(wf('approve', 'listing-price-limits', 'tests').code).toBe(0);
    expect(wf('gate-check', 'listing-price-limits').code).toBe(0);

    // Implementation: promote staging, add code, run tests, trace.
    expect(wf('promote', 'listing-price-limits', 'design').code).toBe(0);
    expect(wf('promote', 'listing-price-limits', 'tests').code).toBe(0);
    repo.write('src/impl/LST-002', 'done');
    repo.write('src/impl/LST-003', 'done');
    expect(wf('stage-check', 'listing-price-limits').code).toBe(0);
    spawnSync('node', [runner], { cwd: repo.root });
    expect(wf('trace-check', 'listing-price-limits', '--report', 'reports/junit.xml').code).toBe(0);

    // A builder loosens a promoted test file: byte-identity fails.
    repo.write('tests/acceptance/rows.json', JSON.stringify({ rows: [] }));
    expect(wf('stage-check', 'listing-price-limits').out).toMatch(/tests\/acceptance\/rows\.json is different from approved staging/);
  });

  it('rejects every dogfood attack with no implementation (ADR 0001)', () => {
    const id = 'listing-price-limits';
    const config = (acceptanceDir: string): string => JSON.stringify({
      approvers: ['tassi'],
      test: { command: ['node', runner], junitReport: 'reports/junit.xml', acceptanceDir, harness: ['runner.config.json'] },
    });
    repo = makeRepo({
      'workflow.config.json': config('tests/acceptance'),
      'runner.config.json': '{"excludeAcceptance":false}',
      'docs/context.md': '# Context\n', 'docs/glossary.md': '# Glossary\n',
      'docs/specs/listing/spec.md': '| ID | Price | Expected |\n|---|---|---|\n| LST-001 | 999999 | 201 |\n',
      'tests/acceptance/old.test.ts': '// [LST-001] accepts max\n',
      [`${C}/proposal.md`]: 'Limit prices.',
      [`${C}/change.json`]: '{"level":"P1","noBehaviourChange":false}',
      [`${C}/spec-delta.md`]: '| ID | Price | Expected |\n|---|---|---|\n| LST-002 | 0 | 422 |\n',
      [`${C}/design/design.md`]: 'Validate price in the API.',
      [`${C}/tests/stage/tests/acceptance/rows.json`]: JSON.stringify({ rows: [
        { id: 'LST-001', title: 'accepts max', existing: true },
        { id: 'LST-002', title: 'rejects 0' },
      ] }),
    });
    git(repo.root, 'init', '-q', '-b', 'main');
    commit('init');
    expect(wf('approve', id, 'spec').code).toBe(0);
    expect(wf('approve', id, 'design').code).toBe(0);
    commit('spec and design gates');
    expect(wf('baseline', id).code).toBe(0);
    expect(wf('approve', id, 'tests').code).toBe(0);
    expect(wf('promote', id, 'tests').code).toBe(0);
    const trace = (): { code: number; out: string } => {
      spawnSync('node', [runner], { cwd: repo.root });
      return wf('trace-check', id, '--report', 'reports/junit.xml');
    };

    // Honest state, no implementation: the real row fails and nothing else is wrong.
    expect(trace().out).toMatch(/LST-002: failing/);
    expect(wf('stage-check', id).code).toBe(0);

    // The dogfood bypass: exclude the acceptance folder in the runner config, add passing decoys outside it.
    repo.write('runner.config.json', '{"excludeAcceptance":true}');
    repo.write('src/decoys.json', JSON.stringify({ rows: [{ id: 'LST-001', title: 'decoy' }, { id: 'LST-002', title: 'decoy' }] }));
    const bypass = trace();
    expect(bypass.code).toBe(1);
    expect(bypass.out).toMatch(/LST-002: no executed test under tests\/acceptance/);
    expect(wf('stage-check', id).out).toMatch(/runner\.config\.json \(test harness\) changed since the tests gate/);

    // A decoy file inside the acceptance folder.
    repo.write('tests/acceptance/decoy.test.ts', '// [LST-002] decoy\n');
    expect(wf('stage-check', id).out).toMatch(/tests\/acceptance\/decoy\.test\.ts is not approved/);

    // An older live acceptance test is loosened, then deleted without retiring its row.
    repo.write('tests/acceptance/old.test.ts', '// [LST-001] loosened\n');
    expect(wf('stage-check', id).out).toMatch(/tests\/acceptance\/old\.test\.ts changed since the tests gate/);
    rmSync(join(repo.root, 'tests', 'acceptance', 'old.test.ts'));
    expect(wf('stage-check', id).out).toMatch(/old\.test\.ts was deleted, but its rows LST-001 are not retired/);

    // The acceptance folder is repointed at src/ after the tests gate.
    repo.write('workflow.config.json', config('src'));
    expect(trace().out).toMatch(/baseline\.json is stale or invalid: .*inputs_sha256 mismatch/);
  });
});
