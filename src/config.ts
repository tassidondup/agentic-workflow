import { readJsonFile } from './change.js';
import { isObject, isStringArray } from './guards.js';
import { assertSafeRepoPath } from './paths.js';

export interface WorkflowConfig {
  readonly approvers: readonly string[];
  readonly test: {
    readonly setup: readonly string[] | null;
    readonly command: readonly string[];
    readonly junitReport: string;
  };
}

const fail = (msg: string): never => {
  throw new Error(`workflow.config.json: ${msg}`);
};

export function parseConfig(raw: unknown): WorkflowConfig {
  if (!isObject(raw)) return fail('must be a JSON object');
  const { approvers, test } = raw;
  if (!isStringArray(approvers) || approvers.length === 0 || approvers.some((a) => a.trim() === '')) {
    return fail('"approvers" must be a non-empty list of GitHub usernames');
  }
  if (!isObject(test)) return fail('"test" must be an object');
  const { setup, command, junitReport } = test;
  if (!isStringArray(command) || command.length === 0) {
    return fail('"test.command" must be a non-empty array of strings (not a shell string)');
  }
  if (setup !== undefined && (!isStringArray(setup) || setup.length === 0)) {
    return fail('"test.setup" must be a non-empty array of strings when present');
  }
  if (typeof junitReport !== 'string') return fail('"test.junitReport" must be a repo-relative path');
  try {
    assertSafeRepoPath(junitReport);
  } catch {
    return fail(`"test.junitReport" is not a safe repo path: ${junitReport}`);
  }
  return Object.freeze({
    approvers: Object.freeze([...approvers]),
    test: Object.freeze({
      setup: setup === undefined ? null : Object.freeze([...setup]),
      command: Object.freeze([...command]),
      junitReport,
    }),
  });
}

export const loadConfig = (root: string): WorkflowConfig =>
  parseConfig(readJsonFile(root, 'workflow.config.json'));
