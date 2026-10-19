import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { approve } from './approve.js';
import { runClassify, runPrCheck, type PrFlags } from './cli-pr.js';
import { runRunTests, type RunFlags } from './cli-run.js';
import type { Exec } from './exec.js';
import { checkAll, checkGate } from './gate-check.js';
import { parseJUnit } from './junit.js';
import { memoryCheck } from './memory-check.js';
import { assertChangeId, toRepoPath } from './paths.js';
import { runBaseline } from './run-baseline.js';
import { readRepoFile } from './safe-fs.js';
import { lintChange } from './spec-lint.js';
import { promote, stageCheck } from './stage.js';
import { traceCheck } from './trace.js';
import { GATES, STAGE_GATES, type Gate, type GateResult, type Issue, type StageGate } from './types.js';
import { UsageError } from './usage-error.js';

export interface Io {
  out(s: string): void;
  err(s: string): void;
  readonly cwd: string;
  readonly exec?: Exec;
}

const USAGE = `Usage: wf <command> [args] [--root <dir>]
  approve <id> <spec|design|tests>     write an approval record (counts once your account merges its PR)
  gate-check <id> [gate]               check approval records (chained)
  promote <id> <design|tests>          copy staging into live paths
  stage-check <id>                     live files must equal approved staging
  baseline <id>                        run staged tests against HEAD, write baseline.json
  trace-check <id> --report <path>     every required row must have an executed, passing test under test.acceptanceDir
  spec-lint <id>                       lint the change's example tables
  memory-check                         check context.md, glossary.md and decision audits
  classify --base <ref> --branch <name>
                                       print kind=, change=, gate= for a PR (stdout is GITHUB_OUTPUT-safe)
  pr-check --base <ref> --base-branch <name> --branch <name> --repo <owner/name>
                                       classify a PR, check its gates and that its records were merged by an approver
  run-tests [--report-out <path>]      run test.setup and test.command; --report-out copies the JUnit report to a repo path`;

const asGate = (g: string | undefined): Gate => {
  if (!GATES.includes(g as Gate)) throw new UsageError('gate must be one of spec, design, tests');
  return g as Gate;
};
const asStageGate = (g: string | undefined): StageGate => {
  if (!STAGE_GATES.includes(g as StageGate)) throw new UsageError('promote takes design or tests');
  return g as StageGate;
};
const needId = (id: string | undefined): string => assertChangeId(id ?? '');
const showGates = (io: Io, results: readonly GateResult[]): number => {
  results.forEach((r) => {
    io.out(`${r.gate.padEnd(7)} ${r.status}`);
    r.problems.forEach((p) => io.out(`        - ${p}`));
  });
  return results.every((r) => r.status === 'valid') ? 0 : 1;
};
const showIssues = (io: Io, issues: readonly Issue[]): number => {
  issues.forEach((i) => io.out(`${i.file}:${i.line} ${i.message}`));
  return issues.length === 0 ? 0 : 1;
};
const showProblems = (io: Io, problems: readonly string[]): number => {
  problems.forEach((p) => io.out(`- ${p}`));
  return problems.length === 0 ? 0 : 1;
};

const ARITY: Readonly<Record<string, number>> = {
  approve: 2,
  'gate-check': 2,
  promote: 2,
  'stage-check': 1,
  baseline: 1,
  'trace-check': 1,
  'spec-lint': 1,
  'memory-check': 0,
  classify: 0,
  'pr-check': 0,
  'run-tests': 0,
};

type Flags = PrFlags & RunFlags & Readonly<{ report?: string }>;

/** Which commands each flag belongs to. A flag on any other command is a usage error. */
const FLAG_COMMANDS: Readonly<Record<keyof Flags, readonly string[]>> = {
  report: ['trace-check'],
  'report-out': ['run-tests'],
  base: ['classify', 'pr-check'],
  'base-branch': ['pr-check'],
  branch: ['classify', 'pr-check'],
  repo: ['pr-check'],
};

function assertFlagsFit(cmd: string | undefined, flags: Flags): void {
  for (const [flag, users] of Object.entries(FLAG_COMMANDS)) {
    if (flags[flag as keyof Flags] !== undefined && !users.includes(cmd ?? '')) {
      throw new UsageError(`--${flag} is only for ${users.join(' and ')}`);
    }
  }
}

function dispatch(cmd: string | undefined, pos: readonly string[], root: string, flags: Flags, io: Io): number {
  const max = cmd ? ARITY[cmd] : undefined;
  if (max !== undefined && pos.length > max) {
    throw new UsageError(`${cmd} takes at most ${max} argument${max === 1 ? '' : 's'}`);
  }
  assertFlagsFit(cmd, flags);
  switch (cmd) {
    case 'approve': {
      const { path } = approve(root, needId(pos[0]), asGate(pos[1]));
      io.out(`Approved: ${toRepoPath(root, path)}`);
      io.out('Open a PR with this record. It only counts once your account merges it.');
      return 0;
    }
    case 'gate-check':
      return showGates(io, pos[1] ? [checkGate(root, needId(pos[0]), asGate(pos[1]))] : checkAll(root, needId(pos[0])));
    case 'promote':
      promote(root, needId(pos[0]), asStageGate(pos[1])).forEach((p) => io.out(p));
      return 0;
    case 'stage-check': {
      return showProblems(io, stageCheck(root, needId(pos[0])));
    }
    case 'baseline': {
      const r = runBaseline(root, needId(pos[0]), io.exec);
      if (r.baseline) {
        Object.entries(r.baseline.rows).forEach(([row, o]) => io.out(`${row} ${o}`));
        r.baseline.flags.forEach((f) => io.out(`FLAG ${f}`));
      }
      return showProblems(io, r.problems);
    }
    case 'trace-check': {
      const report = flags.report;
      if (!report) throw new UsageError('trace-check needs --report <path to JUnit XML>');
      const id = needId(pos[0]);
      const cases = parseJUnit(readRepoFile(root, report, 'utf8'));
      return showProblems(io, traceCheck(root, id, cases));
    }
    case 'spec-lint':
      return showIssues(io, lintChange(root, needId(pos[0])));
    case 'memory-check':
      return showIssues(io, memoryCheck(root));
    case 'classify':
      return runClassify(root, flags, io);
    case 'pr-check':
      return runPrCheck(root, flags, io);
    case 'run-tests':
      return runRunTests(root, flags, io);
    default:
      throw new UsageError(cmd ? `Unknown command: ${cmd}` : 'Missing command');
  }
}

export function run(argv: readonly string[], io: Io): number {
  try {
    const { values, positionals } = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: {
        root: { type: 'string' },
        report: { type: 'string' },
        'report-out': { type: 'string' },
        base: { type: 'string' },
        'base-branch': { type: 'string' },
        branch: { type: 'string' },
        repo: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
    });
    if (values.help) {
      io.out(USAGE);
      return 0;
    }
    const [cmd, ...pos] = positionals;
    return dispatch(cmd, pos, resolve(io.cwd, values.root ?? '.'), values, io);
  } catch (e) {
    io.err(`wf: ${(e as Error).message}`);
    if (e instanceof UsageError) io.err(USAGE);
    return 2;
  }
}
