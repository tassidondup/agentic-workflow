import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { approve } from './approve.js';
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
  trace-check <id> --report <path>     every required row must have an executed, passing test
  spec-lint <id>                       lint the change's example tables
  memory-check                         check context.md, glossary.md and decision audits`;

class UsageError extends Error {}

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
};

function dispatch(cmd: string | undefined, pos: readonly string[], root: string, report: string | undefined, io: Io): number {
  const max = cmd ? ARITY[cmd] : undefined;
  if (max !== undefined && pos.length > max) {
    throw new UsageError(`${cmd} takes at most ${max} argument${max === 1 ? '' : 's'}`);
  }
  if (report !== undefined && cmd !== 'trace-check') throw new UsageError('--report is only for trace-check');
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
      if (!report) throw new UsageError('trace-check needs --report <path to JUnit XML>');
      const id = needId(pos[0]);
      const cases = parseJUnit(readRepoFile(root, report, 'utf8'));
      return showProblems(io, traceCheck(root, id, cases));
    }
    case 'spec-lint':
      return showIssues(io, lintChange(root, needId(pos[0])));
    case 'memory-check':
      return showIssues(io, memoryCheck(root));
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
      options: { root: { type: 'string' }, report: { type: 'string' }, help: { type: 'boolean', short: 'h' } },
    });
    if (values.help) {
      io.out(USAGE);
      return 0;
    }
    const [cmd, ...pos] = positionals;
    return dispatch(cmd, pos, resolve(io.cwd, values.root ?? '.'), values.report, io);
  } catch (e) {
    io.err(`wf: ${(e as Error).message}`);
    if (e instanceof UsageError) io.err(USAGE);
    return 2;
  }
}
