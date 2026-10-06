import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
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
      'workflow.config.json': JSON.stringify({ approvers: ['tassi'], test: { command: ['node', runner], junitReport: 'reports/junit.xml' } }),
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

    // Edit the spec after approval: spec changed, everything downstream blocked.
    repo.write(`${C}/proposal.md`, 'Limit prices (edited).');
    expect(wf('gate-check', 'listing-price-limits').out).toMatch(/spec\s+changed[\s\S]*design\s+blocked[\s\S]*tests\s+blocked/);
    wf('approve', 'listing-price-limits', 'spec');
    expect(wf('gate-check', 'listing-price-limits').out).toMatch(/design\s+stale/);
    wf('approve', 'listing-price-limits', 'design');
    wf('approve', 'listing-price-limits', 'tests');
    expect(wf('gate-check', 'listing-price-limits').code).toBe(0);

    // Implementation: promote staging, add code, run tests, trace.
    wf('promote', 'listing-price-limits', 'design');
    wf('promote', 'listing-price-limits', 'tests');
    repo.write('src/impl/LST-002', 'done');
    repo.write('src/impl/LST-003', 'done');
    expect(wf('stage-check', 'listing-price-limits').code).toBe(0);
    spawnSync('node', [runner], { cwd: repo.root });
    expect(wf('trace-check', 'listing-price-limits', '--report', 'reports/junit.xml').code).toBe(0);

    // A builder loosens a promoted test file: byte-identity fails.
    repo.write('tests/acceptance/rows.json', JSON.stringify({ rows: [] }));
    expect(wf('stage-check', 'listing-price-limits').out).toMatch(/tests\/acceptance\/rows\.json is different from approved staging/);
  });
});
