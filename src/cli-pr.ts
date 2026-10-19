import type { Classification } from './classify.js';
import type { Io } from './cli.js';
import { realExec } from './exec.js';
import { assertRef } from './git.js';
import { classifyDiff, prCheck } from './pr-check.js';
import { UsageError } from './usage-error.js';

export type PrFlags = Readonly<Partial<Record<'base' | 'base-branch' | 'branch' | 'repo', string>>>;

function need(cmd: string, flags: PrFlags, name: keyof PrFlags): string {
  const value = flags[name];
  if (value === undefined || value === '') throw new UsageError(`${cmd} needs --${name} <value>`);
  return value;
}

/** `--base` comes from untrusted PR metadata; an unsafe value is a usage error (exit 2), not a check result. */
function needBase(cmd: string, flags: PrFlags): string {
  try {
    return assertRef(need(cmd, flags, 'base'));
  } catch (e) {
    throw e instanceof UsageError ? e : new UsageError((e as Error).message);
  }
}

/** Control characters (newlines, ESC) in a diff path or branch name must not forge a log line or runner command. */
const escapeControl = (s: string): string =>
  s.replace(/[\x00-\x1f\x7f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

/** GITHUB_OUTPUT lines. Only an enum and validated ids appear here, so no value can inject a line. */
const keyLines = (c: Classification): string[] => [
  `kind=${c.kind}`,
  ...(c.change === null ? [] : [`change=${c.change}`]),
  ...(c.gate === null ? [] : [`gate=${c.gate}`]),
];

/** A git or GitHub failure is a failed check (exit 1), not a usage error. */
function attempt(fn: () => Classification): Classification {
  try {
    return fn();
  } catch (e) {
    return Object.freeze({ kind: 'other', change: null, gate: null, problems: [(e as Error).message] });
  }
}

function show(c: Classification, problemOut: (line: string) => void, io: Io): number {
  if (c.problems.length > 0) {
    c.problems.forEach((p) => problemOut(`- ${escapeControl(p)}`));
    return 1;
  }
  keyLines(c).forEach((l) => io.out(l));
  return 0;
}

/** Writes `key=value` lines to stdout only when there are no problems, so stdout is always safe to append to $GITHUB_OUTPUT. */
export function runClassify(root: string, flags: PrFlags, io: Io): number {
  const base = needBase('classify', flags);
  const branch = need('classify', flags, 'branch');
  return show(attempt(() => classifyDiff(root, base, branch, io.exec ?? realExec)), (l) => io.err(l), io);
}

export function runPrCheck(root: string, flags: PrFlags, io: Io): number {
  const input = {
    base: needBase('pr-check', flags),
    baseBranch: need('pr-check', flags, 'base-branch'),
    headBranch: need('pr-check', flags, 'branch'),
    repo: need('pr-check', flags, 'repo'),
  };
  return show(attempt(() => prCheck(root, input, io.exec ?? realExec)), (l) => io.out(l), io);
}
