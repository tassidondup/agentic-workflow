import type { Classification } from './classify.js';
import type { Io } from './cli.js';
import { realExec } from './exec.js';
import { classifyDiff, prCheck } from './pr-check.js';
import { UsageError } from './usage-error.js';

export type PrFlags = Readonly<Partial<Record<'base' | 'base-branch' | 'branch' | 'repo', string>>>;

function need(cmd: string, flags: PrFlags, name: keyof PrFlags): string {
  const value = flags[name];
  if (value === undefined || value === '') throw new UsageError(`${cmd} needs --${name} <value>`);
  return value;
}

/** GITHUB_OUTPUT lines. Only an enum and validated ids appear here, so no value can inject a line. */
const keyLines = (c: Classification): string[] => [
  `kind=${c.kind}`,
  ...(c.change === null ? [] : [`change=${c.change}`]),
  ...(c.gate === null ? [] : [`gate=${c.gate}`]),
];

/** Writes `key=value` lines to stdout only when there are no problems, so stdout is always safe to append to $GITHUB_OUTPUT. */
export function runClassify(root: string, flags: PrFlags, io: Io): number {
  const base = need('classify', flags, 'base');
  const branch = need('classify', flags, 'branch');
  const c = classifyDiff(root, base, branch, io.exec ?? realExec);
  if (c.problems.length > 0) {
    c.problems.forEach((p) => io.err(`- ${p}`));
    return 1;
  }
  keyLines(c).forEach((l) => io.out(l));
  return 0;
}

export function runPrCheck(root: string, flags: PrFlags, io: Io): number {
  const input = {
    base: need('pr-check', flags, 'base'),
    baseBranch: need('pr-check', flags, 'base-branch'),
    headBranch: need('pr-check', flags, 'branch'),
    repo: need('pr-check', flags, 'repo'),
  };
  const c = prCheck(root, input, io.exec ?? realExec);
  if (c.problems.length > 0) {
    c.problems.forEach((p) => io.out(`- ${p}`));
    return 1;
  }
  keyLines(c).forEach((l) => io.out(l));
  return 0;
}
