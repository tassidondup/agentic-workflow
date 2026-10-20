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
  /** Container image for isolated runs (`wf run-tests --isolate`). Absent when not configured. */
  readonly image?: string;
  /** The must-fail canary test (ADR 0002 layer 1): a locked template and where it is written. Absent when not configured. */
  readonly canary?: CanaryConfig;
}

export interface CanaryConfig {
  readonly template: string;
  readonly path: string;
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

/** An image reference is passed to `docker run`, so it may not hold whitespace or start like an option. */
function parseImage(image: unknown): string {
  if (typeof image !== 'string' || image === '' || /\s/.test(image) || image.startsWith('-')) {
    return fail('"test.image" must be an image reference without spaces, such as node:24');
  }
  return image;
}

function parseCanary(canary: unknown, dir: string, harness: readonly string[]): CanaryConfig {
  if (!isObject(canary)) return fail('"test.canary" must be an object with "template" and "path"');
  const template = safePath(canary.template, 'test.canary.template');
  const path = safePath(canary.path, 'test.canary.path');
  if (!harness.some((h) => isUnderPath(h, template))) {
    return fail('"test.canary.template" must be a test.harness path (or inside one), so the baseline locks it');
  }
  if (!isUnderPath(dir, path)) return fail('"test.canary.path" must be inside "test.acceptanceDir"');
  return Object.freeze({ template, path });
}

function parseTest(test: unknown): TestConfig {
  if (!isObject(test)) return fail('"test" must be an object');
  const { setup, command, junitReport, acceptanceDir, harness, image, canary } = test;
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
  const safeHarness = harness.map((h: unknown, i) => safePath(h, `test.harness[${i}]`));
  return Object.freeze({
    setup: setup === undefined ? null : Object.freeze([...setup]),
    command: Object.freeze([...command]),
    junitReport: report,
    acceptanceDir: dir,
    harness: Object.freeze(safeHarness),
    // Left out when unset, so a baseline made before these existed keeps its inputs_sha256.
    ...(image === undefined ? {} : { image: parseImage(image) }),
    ...(canary === undefined ? {} : { canary: parseCanary(canary, dir, safeHarness) }),
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
