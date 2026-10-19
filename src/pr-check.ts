import { classifyPr, type Classification } from './classify.js';
import { CONFIG_FILE, parseConfig } from './config.js';
import type { Exec } from './exec.js';
import { checkGate } from './gate-check.js';
import { changedFiles, fileAt } from './git.js';
import { ghReader, type GitHubReader } from './github.js';
import { provenanceProblems } from './provenance.js';
import { GATES, PREREQS, type Gate, type GateResult } from './types.js';

export interface PrCheckInput {
  readonly base: string;
  readonly baseBranch: string;
  readonly headBranch: string;
  readonly repo: string;
}

interface Plan {
  readonly id: string;
  readonly check: readonly Gate[];
  readonly prove: readonly Gate[];
}

/** Classifies the PR from `git diff <base>...HEAD` and its head branch. Both inputs are untrusted. */
export function classifyDiff(root: string, base: string, headBranch: string, exec: Exec): Classification {
  return classifyPr(changedFiles(root, base, exec), headBranch);
}

/** What to verify for a classified PR, or null if nothing. Throws if the classification is incomplete (fail closed). */
function planFor(c: Classification): Plan | null {
  if (c.kind === 'other') return null;
  if (c.kind === 'change' && c.change !== null) return { id: c.change, check: GATES, prove: GATES };
  if (c.kind === 'gate' && c.change !== null && c.gate !== null) return { id: c.change, check: [c.gate], prove: PREREQS[c.gate] };
  throw new Error(`Incomplete classification for a ${c.kind} PR`);
}

function statusProblems(results: readonly GateResult[]): string[] {
  return results.flatMap((r) => {
    if (r.status === 'valid') return [];
    if (r.problems.length === 0) return [`${r.gate} gate is ${r.status}`];
    return r.problems.map((p) => `${r.gate} gate is ${r.status}: ${p}`);
  });
}

/**
 * Approvers are deliberately read from the BASE commit, never the PR head: a PR must not be able to
 * add itself (or a bot) to the list that vouches for the records it relies on.
 */
function baseApprovers(root: string, base: string, exec: Exec): { approvers: readonly string[] } | { problem: string } {
  const text = fileAt(root, base, CONFIG_FILE, exec);
  if (text === null) return { problem: `${CONFIG_FILE} is not on ${base}; approvers must come from the base branch` };
  try {
    return { approvers: parseConfig(JSON.parse(text) as unknown).approvers };
  } catch (e) {
    return { problem: `${CONFIG_FILE} on ${base} is unusable for approvers: ${(e as Error).message}` };
  }
}

const withProblems = (c: Classification, extra: readonly string[]): Classification =>
  Object.freeze({ ...c, problems: Object.freeze([...new Set([...c.problems, ...extra])]) });

/**
 * Classifies the PR, then checks the gates it is responsible for and that the records it relies on were merged by an approver.
 * Returns early, with no GitHub call, when the classification already has problems.
 * `gh` is created only when a provenance check is needed.
 */
export function prCheck(root: string, input: PrCheckInput, exec: Exec, gh?: GitHubReader): Classification {
  const classified = classifyDiff(root, input.base, input.headBranch, exec);
  if (classified.problems.length > 0) return classified;
  const plan = planFor(classified);
  if (plan === null) return classified;
  const problems = statusProblems(plan.check.map((gate) => checkGate(root, plan.id, gate)));
  if (plan.prove.length > 0) {
    const found = baseApprovers(root, input.base, exec);
    if ('problem' in found) {
      problems.push(found.problem);
    } else {
      const provenance = { id: plan.id, gates: plan.prove, base: input.base, baseBranch: input.baseBranch, approvers: found.approvers };
      problems.push(...provenanceProblems(root, provenance, gh ?? ghReader(input.repo, root, exec), exec));
    }
  }
  return withProblems(classified, problems);
}
