import type { Exec } from './exec.js';
import { blobAt, lastCommitTouching } from './git.js';
import type { GitHubReader, Review } from './github.js';
import { recordRepoPath } from './record.js';
import type { Gate } from './types.js';

export interface ProvenanceInput {
  readonly id: string;
  readonly gates: readonly Gate[];
  readonly base: string;
  readonly baseBranch: string;
  readonly approvers: readonly string[];
}

const DECIDING_STATES: ReadonlySet<string> = new Set(['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED']);
const SHORT_SHA = 7;

const lower = (login: string): string => login.toLowerCase();
const isApprover = (login: string | null, approvers: readonly string[]): boolean =>
  login !== null && approvers.some((a) => lower(a) === lower(login));

/** Review time in ms, or null if it cannot be ordered (missing or unparseable). */
function reviewTime(r: Review): number | null {
  if (r.submittedAt === null) return null;
  const t = Date.parse(r.submittedAt);
  return Number.isNaN(t) ? null : t;
}

/**
 * True if some approver's latest deciding review (APPROVED, CHANGES_REQUESTED or DISMISSED) is an approval of `headSha`.
 * An approver whose deciding reviews cannot be ordered is treated as not approving (fail closed).
 */
export function approvedByApprover(reviews: readonly Review[], approvers: readonly string[], headSha: string): boolean {
  const latest = new Map<string, { readonly review: Review; readonly time: number }>();
  const unorderable = new Set<string>();
  for (const review of reviews) {
    if (review.user === null || !isApprover(review.user, approvers) || !DECIDING_STATES.has(review.state)) continue;
    const key = lower(review.user);
    const time = reviewTime(review);
    if (time === null) {
      unorderable.add(key);
      continue;
    }
    const prev = latest.get(key);
    if (prev === undefined || time >= prev.time) latest.set(key, { review, time });
  }
  return [...latest].some(
    ([key, e]) => !unorderable.has(key) && e.review.state === 'APPROVED' && e.review.commitId === headSha,
  );
}

function mergedPullNumbers(gh: GitHubReader, commit: string, baseBranch: string): readonly number[] {
  return gh
    .pullsForCommit(commit)
    .filter((p) => p.mergedAt !== null && p.baseRef === baseBranch)
    .map((p) => p.number);
}

/** Returns the problem for one gate's record, or null if its provenance holds. */
function checkGate(root: string, input: ProvenanceInput, gate: Gate, gh: GitHubReader, exec: Exec): string | null {
  const path = recordRepoPath(input.id, gate);
  const onBase = blobAt(root, input.base, path, exec);
  if (onBase === null) return `${path} is not on ${input.base}: its PR has not been merged`;
  if (onBase !== blobAt(root, 'HEAD', path, exec)) {
    return `${path} was changed in this PR; a record counts only after its own gate PR is merged`;
  }
  const commit = lastCommitTouching(root, input.base, path, exec);
  if (commit === null) return `${path} has no commit on ${input.base}`;
  const short = commit.slice(0, SHORT_SHA);
  const numbers = mergedPullNumbers(gh, commit, input.baseBranch);
  if (numbers.length === 0) return `${path} was added by commit ${short} with no merged PR into ${input.baseBranch}`;
  const [n] = numbers;
  if (n === undefined || numbers.length > 1) {
    return `${path} was added by commit ${short} by more than one PR (${numbers.map((x) => `#${x}`).join(', ')})`;
  }
  const detail = gh.pull(n);
  if (!detail.merged) return `${path}: PR #${n} is not merged`;
  if (detail.mergedBy === null || !isApprover(detail.mergedBy, input.approvers)) {
    return `${path}: PR #${n} was merged by ${detail.mergedBy ?? 'nobody'}, who is not an approver`;
  }
  if (isApprover(detail.author, input.approvers)) return null;
  if (approvedByApprover(gh.reviews(n), input.approvers, detail.headSha)) return null;
  return `${path}: PR #${n} has no approving review from an approver on its final commit`;
}

/** One problem per gate whose approval record was not merged, via its own PR, by an approver. Empty means all hold. */
export function provenanceProblems(root: string, input: ProvenanceInput, gh: GitHubReader, exec: Exec): string[] {
  const problems: string[] = [];
  for (const gate of input.gates) {
    try {
      const problem = checkGate(root, input, gate, gh, exec);
      if (problem !== null) problems.push(problem);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      problems.push(`${recordRepoPath(input.id, gate)}: ${message}`);
    }
  }
  return Object.freeze(problems) as string[];
}
