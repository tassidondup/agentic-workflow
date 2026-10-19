import { readJsonFile } from './change.js';
import { isObject, isStringArray } from './guards.js';
import { floorFor, isNeverExempt } from './exempt.js';
import { assertSafeRepoPath, isUnderPath } from './paths.js';

export interface TestConfig {
  readonly setup: readonly string[] | null;
  readonly command: readonly string[];
  readonly junitReport: string;
  readonly acceptanceDir: string;
  readonly harness: readonly string[];
}

export interface WorkflowConfig {
  readonly approvers: readonly string[];
  readonly exempt: readonly string[];
  readonly test: TestConfig;
}

const fail = (msg: string): never => {
  throw new Error(`workflow.config.json: ${msg}`);
};

const safePath = (value: unknown, label: string): string => {
  if (typeof value !== 'string') return fail(`"${label}" must be a repo-relative path`);
  try {
    return assertSafeRepoPath(value);
  } catch {
    return fail(`"${label}" is not a safe repo path: ${value}`);
  }
};

const STAGING = 'docs/changes';

function parseTest(test: unknown): TestConfig {
  if (!isObject(test)) return fail('"test" must be an object');
  const { setup, command, junitReport, acceptanceDir, harness } = test;
  if (!isStringArray(command) || command.length === 0) {
    return fail('"test.command" must be a non-empty array of strings (not a shell string)');
  }
  if (setup !== undefined && (!isStringArray(setup) || setup.length === 0)) {
    return fail('"test.setup" must be a non-empty array of strings when present');
  }
  const report = safePath(junitReport, 'test.junitReport');
  const dir = safePath(acceptanceDir, 'test.acceptanceDir');
  if (isUnderPath(dir, STAGING) || isUnderPath(STAGING, dir)) {
    return fail('"test.acceptanceDir" may not overlap docs/changes/, where staged tests live');
  }
  if (isUnderPath(dir, report)) return fail('"test.junitReport" may not be inside "test.acceptanceDir"');
  if (!Array.isArray(harness)) return fail('"test.harness" must be a list of repo paths (it may be empty)');
  return Object.freeze({
    setup: setup === undefined ? null : Object.freeze([...setup]),
    command: Object.freeze([...command]),
    junitReport: report,
    acceptanceDir: dir,
    harness: Object.freeze(harness.map((h: unknown, i) => safePath(h, `test.harness[${i}]`))),
  });
}

/** Repo paths (a folder or one file) whose PRs skip the gates. Absent means nothing is exempt. Nothing in the never-exempt floor can be listed. */
function parseExempt(exempt: unknown, test: TestConfig): readonly string[] {
  if (exempt === undefined) return Object.freeze([]);
  if (!Array.isArray(exempt)) return fail('"exempt" must be a list of repo paths');
  const floor = floorFor(test);
  const entries = exempt.map((e: unknown, i) => {
    const path = safePath(typeof e === 'string' && e.endsWith('/') ? e.slice(0, -1) : e, `exempt[${i}]`);
    if (isNeverExempt(path, floor)) return fail(`"exempt[${i}]" (${path}) is a protected path and cannot be exempt`);
    return path;
  });
  return Object.freeze([...new Set(entries)]);
}

export function parseConfig(raw: unknown): WorkflowConfig {
  if (!isObject(raw)) return fail('must be a JSON object');
  const { approvers, test, exempt } = raw;
  if (!isStringArray(approvers) || approvers.length === 0 || approvers.some((a) => a.trim() === '')) {
    return fail('"approvers" must be a non-empty list of GitHub usernames');
  }
  const parsedTest = parseTest(test);
  return Object.freeze({ approvers: Object.freeze([...approvers]), exempt: parseExempt(exempt, parsedTest), test: parsedTest });
}

export const CONFIG_FILE = 'workflow.config.json';

export const loadConfig = (root: string): WorkflowConfig =>
  parseConfig(readJsonFile(root, CONFIG_FILE));
