import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { realExec } from '../src/exec.js';
import type { GitHubReader, PullDetail, PullSummary, Review } from '../src/github.js';
import { approvedByApprover, provenanceProblems, type ProvenanceInput } from '../src/provenance.js';
import { git, makeRepo, type TestRepo } from './helpers/repo.js';

const HEAD = 'a'.repeat(40);
const APPROVERS = ['tassi'];
const SPEC = 'docs/changes/c1/approvals/spec.json';
const DESIGN = 'docs/changes/c1/approvals/design.json';

const review = (user: string | null, state: string, at: string, commitId: string | null = HEAD): Review => ({
  user,
  state,
  commitId,
  submittedAt: at,
});

describe('approvedByApprover', () => {
  const t = (n: number): string => `2026-10-01T00:00:0${n}Z`;
  const cases: ReadonlyArray<readonly [string, readonly Review[], boolean]> = [
    ['approval on head by an approver', [review('tassi', 'APPROVED', t(1))], true],
    ['approval on an older commit', [review('tassi', 'APPROVED', t(1), 'b'.repeat(40))], false],
    ['approval then changes requested', [review('tassi', 'APPROVED', t(1)), review('tassi', 'CHANGES_REQUESTED', t(2))], false],
    ['changes requested then approval', [review('tassi', 'CHANGES_REQUESTED', t(1)), review('tassi', 'APPROVED', t(2))], true],
    ['approval then dismissed', [review('tassi', 'APPROVED', t(1)), review('tassi', 'DISMISSED', t(2))], false],
    ['approval by a non-approver', [review('agent-bot', 'APPROVED', t(1))], false],
    ['login case differs', [review('Tassi', 'APPROVED', t(1))], true],
    ['later comment keeps the approval', [review('tassi', 'APPROVED', t(1)), review('tassi', 'COMMENTED', t(2))], true],
    ['unknown state is ignored', [review('tassi', 'APPROVED', t(1)), review('tassi', 'SOMETHING_NEW', t(2))], true],
    ['no reviews', [], false],
    ['review with a deleted user', [review(null, 'APPROVED', t(1))], false],
    ['out-of-order list uses submittedAt', [review('tassi', 'CHANGES_REQUESTED', t(2)), review('tassi', 'APPROVED', t(1))], false],
    ['same timestamp ties go to list order', [review('tassi', 'CHANGES_REQUESTED', t(1)), review('tassi', 'APPROVED', t(1))], true],
    ['a non-approver rejection does not cancel', [review('tassi', 'APPROVED', t(1)), review('agent-bot', 'CHANGES_REQUESTED', t(2))], true],
    ['missing submittedAt cannot be ordered', [{ user: 'tassi', state: 'APPROVED', commitId: HEAD, submittedAt: null }], false],
    ['unparseable submittedAt cannot be ordered', [review('tassi', 'APPROVED', 'not a date')], false],
  ];
  it.each(cases)('%s', (_name, reviews, expected) => {
    expect(approvedByApprover(reviews, APPROVERS, HEAD)).toBe(expected);
  });
});

describe('provenanceProblems', () => {
  let repo: TestRepo;
  let mainCommit: string;
  beforeEach(() => {
    repo = makeRepo({ [SPEC]: '{"v":1}\n', [DESIGN]: '{"v":1}\n' });
    git(repo.root, 'init', '-b', 'main');
    git(repo.root, 'add', '-A');
    git(repo.root, 'commit', '-m', 'add records');
    mainCommit = git(repo.root, 'rev-parse', 'HEAD').trim();
    git(repo.root, 'checkout', '-b', 'feature');
    repo.write('src-change.txt', 'x');
    git(repo.root, 'add', '-A');
    git(repo.root, 'commit', '-m', 'branch work');
  });
  afterEach(() => repo.cleanup());

  const input = (gates: ProvenanceInput['gates'] = ['spec']): ProvenanceInput => ({
    id: 'c1',
    gates,
    base: 'main',
    baseBranch: 'main',
    approvers: APPROVERS,
  });
  const summary = (over: Partial<PullSummary> = {}): PullSummary => ({ number: 7, mergedAt: '2026-10-01T00:00:00Z', baseRef: 'main', ...over });
  const detail = (over: Partial<PullDetail> = {}): PullDetail => ({
    number: 7,
    merged: true,
    mergedBy: 'tassi',
    author: 'agent-bot',
    headSha: HEAD,
    ...over,
  });
  const stub = (o: { pulls?: readonly PullSummary[]; detail?: PullDetail; reviews?: readonly Review[] } = {}): GitHubReader => ({
    pullsForCommit: (sha) => (sha === mainCommit ? (o.pulls ?? [summary()]) : []),
    pull: () => o.detail ?? detail(),
    reviews: () => o.reviews ?? [review('tassi', 'APPROVED', '2026-10-01T00:00:01Z')],
  });
  const run = (gh: GitHubReader, i: ProvenanceInput = input()): string[] => provenanceProblems(repo.root, i, gh, realExec);

  it('a record merged by an approver on a bot-authored PR with an approving review passes', () => {
    expect(run(stub())).toEqual([]);
  });

  it('a record merged by the human author with no review passes', () => {
    expect(run(stub({ detail: detail({ author: 'tassi' }), reviews: [] }))).toEqual([]);
  });

  it('a record whose PR was merged by the bot is rejected', () => {
    const [p, ...rest] = run(stub({ detail: detail({ mergedBy: 'agent-bot' }) }));
    expect(rest).toEqual([]);
    expect(p).toContain('agent-bot');
    expect(p).toContain('not an approver');
  });

  it('a record merged by nobody is rejected', () => {
    expect(run(stub({ detail: detail({ mergedBy: null }) }))[0]).toContain('merged by nobody');
  });

  it('a null author never satisfies the author-is-approver branch', () => {
    const problems = run(stub({ detail: detail({ author: null }), reviews: [] }));
    expect(problems[0]).toContain('no approving review');
  });

  it('a bot-authored PR merged by an approver with no review is rejected', () => {
    expect(run(stub({ reviews: [] }))[0]).toContain('no approving review from an approver on its final commit');
  });

  it('a record whose commit has no PR is rejected', () => {
    expect(run(stub({ pulls: [] }))[0]).toContain(`was added by commit ${mainCommit.slice(0, 7)} with no merged PR into main`);
  });

  it('an unmerged PR is rejected', () => {
    expect(run(stub({ pulls: [summary({ mergedAt: null })] }))[0]).toContain('no merged PR into main');
  });

  it('a PR merged into another branch is rejected', () => {
    expect(run(stub({ pulls: [summary({ baseRef: 'other' })] }))[0]).toContain('no merged PR into main');
  });

  it('two merged PRs for the commit are rejected', () => {
    const pulls = [summary({ number: 7 }), summary({ number: 8 })];
    expect(run(stub({ pulls }))[0]).toContain('by more than one PR (#7, #8)');
  });

  it('a PR reported as not merged by its detail is rejected', () => {
    expect(run(stub({ detail: detail({ merged: false }) }))).toHaveLength(1);
  });

  it('a record missing on the base is rejected', () => {
    const problems = run(stub(), input(['tests']));
    expect(problems).toEqual(['docs/changes/c1/approvals/tests.json is not on main: its PR has not been merged']);
  });

  it('a record changed in this PR is rejected', () => {
    repo.write(SPEC, '{"v":2}\n');
    git(repo.root, 'add', '-A');
    git(repo.root, 'commit', '-m', 'edit record');
    expect(run(stub())[0]).toBe(`${SPEC} was changed in this PR; a record counts only after its own gate PR is merged`);
  });

  it('an unknown base ref becomes a problem, not a throw', () => {
    const problems = run(stub(), { ...input(), base: 'nope' });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(new RegExp(`^${SPEC}: `));
  });

  it('a gh failure becomes a problem, not a throw', () => {
    const gh: GitHubReader = {
      pullsForCommit: () => {
        throw new Error('HTTP 502');
      },
      pull: () => detail(),
      reviews: () => [],
    };
    expect(run(gh)).toEqual([`${SPEC}: HTTP 502`]);
  });

  it('a non-Error throw becomes a problem', () => {
    const gh: GitHubReader = {
      pullsForCommit: () => {
        throw 'boom';
      },
      pull: () => detail(),
      reviews: () => [],
    };
    expect(run(gh)).toEqual([`${SPEC}: boom`]);
  });

  it('all gates are reported, not just the first', () => {
    const problems = run(stub({ pulls: [] }), input(['spec', 'design']));
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain(SPEC);
    expect(problems[1]).toContain(DESIGN);
  });

  it('returns a frozen array', () => {
    expect(Object.isFrozen(run(stub()))).toBe(true);
  });
});
