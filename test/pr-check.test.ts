import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { approve } from '../src/approve.js';
import { realExec } from '../src/exec.js';
import { checkGate } from '../src/gate-check.js';
import { prCheck, type PrCheckInput } from '../src/pr-check.js';
import { CONFIG, writeValidBaseline, changeFiles } from './helpers/change.js';
import { ghCalls, resetGhCalls, withFakeGh, type GhRoute } from './helpers/fake-gh.js';
import { git, makeRepo, type TestRepo } from './helpers/repo.js';

const C = 'docs/changes/c1';
const REPO = 'acme/app';
const HEAD_SHA = 'a'.repeat(40);
const TESTS_STAGE = `${C}/tests/stage/tests/acceptance/a.test.ts`;

interface Merge {
  readonly sha: string;
  readonly n: number;
  readonly mergedBy?: string;
  readonly baseRef?: string;
}

/** Routes that make `sha` the commit of merged PR #n (bot-authored, approved on its head by tassi). */
function mergedPr({ sha, n, mergedBy = 'tassi', baseRef = 'main' }: Merge): GhRoute[] {
  const api = `repos/${REPO}`;
  return [
    { path: `${api}/commits/${sha}/pulls?per_page=100`, body: [{ number: n, merged_at: '2026-10-01T00:00:00Z', base: { ref: baseRef } }] },
    {
      path: `${api}/pulls/${n}`,
      body: { number: n, merged: true, merged_by: { login: mergedBy }, user: { login: 'agent-bot' }, head: { sha: HEAD_SHA } },
    },
    {
      path: `${api}/pulls/${n}/reviews?per_page=100&page=1`,
      body: [{ user: { login: 'tassi' }, state: 'APPROVED', commit_id: HEAD_SHA, submitted_at: '2026-10-01T00:00:01Z' }],
    },
  ];
}

let repo: TestRepo;
beforeEach(() => resetGhCalls());
afterEach(() => repo?.cleanup());

const commit = (message: string): string => {
  git(repo.root, 'add', '-A');
  git(repo.root, 'commit', '-m', message);
  return git(repo.root, 'rev-parse', 'HEAD').trim();
};

/** Files of a change before its tests exist: config, spec and design. */
function specAndDesignFiles(): Record<string, string> {
  const { [TESTS_STAGE]: _tests, ...rest } = changeFiles();
  return rest;
}

/** main holds the merged spec record (one commit) and, if asked, the design record (a second commit). */
function mainWith(through: 'spec' | 'design'): { spec: string; design: string } {
  repo = makeRepo(specAndDesignFiles());
  git(repo.root, 'init', '-b', 'main');
  approve(repo.root, 'c1', 'spec');
  const spec = commit('spec');
  if (through === 'spec') return { spec, design: '' };
  approve(repo.root, 'c1', 'design');
  return { spec, design: commit('design') };
}

/** Writes the staged tests and their approval record into the working tree (not committed). */
function approveTests(): void {
  repo.write(TESTS_STAGE, 't');
  writeValidBaseline(repo);
  approve(repo.root, 'c1', 'tests');
}

/** main with all three records merged, then a `change/c1` branch carrying one source file. */
function implementationBranch(): { spec: string; design: string; tests: string } {
  const { spec, design } = mainWith('design');
  approveTests();
  const tests = commit('tests');
  git(repo.root, 'checkout', '-b', 'change/c1');
  repo.write('src/feature.ts', 'export const x = 1;\n');
  commit('implement');
  return { spec, design, tests };
}

const input = (headBranch: string): PrCheckInput => ({ base: 'main', baseBranch: 'main', headBranch, repo: REPO });
const check = (headBranch: string, routes: readonly GhRoute[] = []) =>
  prCheck(repo.root, input(headBranch), withFakeGh(routes, realExec));
const allMerged = (s: { spec: string; design: string; tests: string }): GhRoute[] => [
  ...mergedPr({ sha: s.spec, n: 7 }),
  ...mergedPr({ sha: s.design, n: 8 }),
  ...mergedPr({ sha: s.tests, n: 9 }),
];

describe('prCheck: implementation PRs', () => {
  it('a correct implementation PR passes', () => {
    const shas = implementationBranch();
    const r = check('change/c1', allMerged(shas));
    expect(r.problems).toEqual([]);
    expect(r).toMatchObject({ kind: 'change', change: 'c1', gate: null });
  });

  it('an implementation PR whose design record was merged by the bot is rejected', () => {
    const shas = implementationBranch();
    const routes = [...mergedPr({ sha: shas.spec, n: 7 }), ...mergedPr({ sha: shas.design, n: 8, mergedBy: 'agent-bot' }), ...mergedPr({ sha: shas.tests, n: 9 })];
    const r = check('change/c1', routes);
    expect(r.problems).toEqual([`${C}/approvals/design.json: PR #8 was merged by agent-bot, who is not an approver`]);
  });

  it('an implementation PR that edits a covered design file is rejected', () => {
    const shas = implementationBranch();
    repo.write(`${C}/design/design.md`, 'edited');
    commit('edit design');
    const r = check('change/c1', allMerged(shas));
    expect(r.problems).toContain(`design gate is changed: ${C}/design/design.md changed`);
    expect(r.problems.some((p) => p.startsWith('tests gate is blocked'))).toBe(true);
  });

  it('an implementation PR that rewrites a record is rejected as a gate PR that strays outside its change', () => {
    const shas = implementationBranch();
    repo.write(`${C}/approvals/design.json`, '{"v":2}\n');
    commit('rewrite record');
    const r = check('change/c1', allMerged(shas));
    expect(r.kind).toBe('gate');
    expect(r.problems).toEqual(['src/feature.ts is outside docs/changes/c1/']);
    expect(ghCalls).toEqual([]);
  });

  it('an implementation PR that deletes a record is rejected as changed in this PR', () => {
    const shas = implementationBranch();
    rmSync(join(repo.root, C, 'approvals', 'design.json'));
    commit('delete record');
    const r = check('change/c1', allMerged(shas));
    expect(r.kind).toBe('change');
    expect(r.problems).toContain(`${C}/approvals/design.json was changed in this PR; a record counts only after its own gate PR is merged`);
    expect(r.problems).toContain('design gate is missing: No approval record for the design gate');
  });

  it('an implementation PR whose branch is not a change id is rejected before any GitHub call', () => {
    implementationBranch();
    git(repo.root, 'checkout', '-b', 'change/Bad_ID');
    const r = check('change/Bad_ID');
    expect(r.kind).toBe('other');
    expect(r.problems).toEqual(['branch change/Bad_ID is not a valid change id']);
    expect(ghCalls).toEqual([]);
  });

  it('rejects an unsafe base ref instead of passing it to git', () => {
    implementationBranch();
    const bad = { ...input('change/c1'), base: '--upload-pack=x' };
    expect(() => prCheck(repo.root, bad, withFakeGh([], realExec))).toThrow(/Unsafe git ref/);
  });
});

describe('prCheck: approvers come from the base commit', () => {
  it('a PR that adds the bot to approvers in its own diff is still rejected', () => {
    const shas = implementationBranch();
    const widened = { ...JSON.parse(CONFIG), approvers: ['tassi', 'agent-bot'] };
    repo.write('workflow.config.json', JSON.stringify(widened));
    commit('make the bot an approver');
    const routes = [...mergedPr({ sha: shas.spec, n: 7 }), ...mergedPr({ sha: shas.design, n: 8, mergedBy: 'agent-bot' }), ...mergedPr({ sha: shas.tests, n: 9 })];
    const r = check('change/c1', routes);
    expect(r.kind).toBe('change');
    expect(r.problems).toEqual([`${C}/approvals/design.json: PR #8 was merged by agent-bot, who is not an approver`]);
  });

  it('a base without workflow.config.json is a problem and makes no GitHub call', () => {
    mainWith('design');
    git(repo.root, 'rm', '-q', 'workflow.config.json');
    commit('drop config');
    git(repo.root, 'checkout', '-b', 'change/c1');
    repo.write('src/feature.ts', 'x');
    commit('implement');
    const r = check('change/c1');
    expect(r.problems).toContain('workflow.config.json is not on main; approvers must come from the base branch');
    expect(ghCalls).toEqual([]);
  });

  it('a base config that cannot be parsed is a problem, not a throw', () => {
    mainWith('design');
    repo.write('workflow.config.json', '{not json');
    commit('break config');
    git(repo.root, 'checkout', '-b', 'change/c1');
    repo.write('src/feature.ts', 'x');
    commit('implement');
    const r = check('change/c1');
    expect(r.problems.some((p) => p.startsWith('workflow.config.json on main is unusable for approvers'))).toBe(true);
    expect(ghCalls).toEqual([]);
  });
});

describe('prCheck: gate PRs', () => {
  it('a tests gate PR that also edits vitest.config.ts is rejected before any GitHub call', () => {
    mainWith('design');
    git(repo.root, 'checkout', '-b', 'gate/c1-tests');
    approveTests();
    repo.write('vitest.config.ts', 'export default {};\n');
    commit('tests gate plus config');
    const r = check('gate/c1-tests');
    expect(r.problems).toEqual(['vitest.config.ts is outside docs/changes/c1/']);
    expect(r.kind).toBe('gate');
    expect(ghCalls).toEqual([]);
  });

  it('a clean tests gate PR passes', () => {
    const { spec, design } = mainWith('design');
    git(repo.root, 'checkout', '-b', 'gate/c1-tests');
    approveTests();
    commit('tests gate');
    const r = check('gate/c1-tests', [...mergedPr({ sha: spec, n: 7 }), ...mergedPr({ sha: design, n: 8 })]);
    expect(r.problems).toEqual([]);
    expect(r).toMatchObject({ kind: 'gate', change: 'c1', gate: 'tests' });
    expect(checkGate(repo.root, 'c1', 'tests').status).toBe('valid');
    expect(ghCalls.length).toBeGreaterThan(0);
  });

  it("a tests gate PR whose design record isn't on main is rejected", () => {
    const { spec } = mainWith('spec');
    git(repo.root, 'checkout', '-b', 'gate/c1-tests');
    approve(repo.root, 'c1', 'design');
    approveTests();
    rmSync(join(repo.root, C, 'approvals', 'design.json'));
    commit('tests gate without its design record');
    const r = check('gate/c1-tests', mergedPr({ sha: spec, n: 7 }));
    expect(r.kind).toBe('gate');
    expect(r.problems).toContain(`${C}/approvals/design.json is not on main: its PR has not been merged`);
  });

  it("a gate PR whose record doesn't match its files is rejected", () => {
    const { spec, design } = mainWith('design');
    git(repo.root, 'checkout', '-b', 'gate/c1-tests');
    approveTests();
    repo.write(TESTS_STAGE, 'changed after approval');
    commit('tests gate with stale record');
    const r = check('gate/c1-tests', [...mergedPr({ sha: spec, n: 7 }), ...mergedPr({ sha: design, n: 8 })]);
    expect(r.problems).toEqual([`tests gate is changed: ${TESTS_STAGE} changed`]);
  });

  it('a spec gate PR needs no provenance and makes no GitHub call', () => {
    repo = makeRepo(specAndDesignFiles());
    git(repo.root, 'init', '-b', 'main');
    git(repo.root, 'add', 'workflow.config.json');
    git(repo.root, 'commit', '-m', 'init');
    git(repo.root, 'checkout', '-b', 'gate/c1-spec');
    approve(repo.root, 'c1', 'spec');
    commit('spec gate');
    const r = check('gate/c1-spec');
    expect(r.problems).toEqual([]);
    expect(r).toMatchObject({ kind: 'gate', gate: 'spec' });
    expect(ghCalls).toEqual([]);
  });
});

describe('prCheck: other PRs', () => {
  it('an other PR passes without touching GitHub', () => {
    mainWith('design');
    git(repo.root, 'checkout', '-b', 'docs-fix');
    repo.write('README.md', 'hello\n');
    commit('docs');
    const r = check('docs-fix');
    expect(r).toEqual({ kind: 'other', change: null, gate: null, problems: [] });
    expect(ghCalls).toEqual([]);
  });

  it('returns frozen results', () => {
    mainWith('design');
    git(repo.root, 'checkout', '-b', 'docs-fix');
    repo.write('README.md', 'hello\n');
    commit('docs');
    const r = check('docs-fix');
    expect(Object.isFrozen(r)).toBe(true);
    expect(Object.isFrozen(r.problems)).toBe(true);
  });
});
