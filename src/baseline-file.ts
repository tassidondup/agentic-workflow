import { behaviourProblems } from './baseline.js';
import { readChange, readJsonFile, readRetires } from './change.js';
import { CONFIG_FILE, loadConfig } from './config.js';
import { isObject } from './guards.js';
import { canonicalJson, sha256 } from './hash.js';
import { changeRepoDir } from './paths.js';
import { hashRepoFile, listRepoFiles, lstatInRepo } from './safe-fs.js';
import { changeRowIds } from './spec-index.js';

// The parsed `test` block of workflow.config.json (null when there is no config), so changing the
// setup, command or report path after a baseline invalidates it; editing approvers does not.
const testConfig = (root: string): unknown =>
  lstatInRepo(root, CONFIG_FILE) === null ? null : loadConfig(root).test;

/**
 * sha256 binding a baseline to what it measured: spec-delta.md, every file under tests/,
 * retires.json (null when absent) and the test configuration. Used by run-baseline (on HEAD)
 * and approve (on the tree).
 */
export function baselineInputs(root: string, id: string): string {
  const dir = changeRepoDir(id);
  const retires = `${dir}/retires.json`;
  return sha256(canonicalJson({
    spec_delta: hashRepoFile(root, `${dir}/spec-delta.md`),
    tests: listRepoFiles(root, `${dir}/tests`).map((path) => ({ path, sha256: hashRepoFile(root, path) })),
    retires: lstatInRepo(root, retires) === null ? null : hashRepoFile(root, retires),
    test_config: testConfig(root),
  }));
}

const fail = (reason: string): never => {
  throw new Error(`baseline.json is stale or invalid: ${reason}; re-run wf baseline`);
};

function readBaselineJson(root: string, id: string): Record<string, unknown> {
  let raw: unknown;
  try {
    raw = readJsonFile(root, `${changeRepoDir(id)}/baseline.json`);
  } catch (e) {
    return fail((e as Error).message);
  }
  return isObject(raw) ? raw : fail('must be a JSON object');
}

/** Throws unless baseline.json was produced by `wf baseline` for the current spec-delta, tests and retirements. */
export function validateBaseline(root: string, id: string): void {
  const raw = readBaselineJson(root, id);
  if (raw.change !== id) fail(`"change" must be "${id}"`);
  const rows = isObject(raw.rows) ? raw.rows : fail('"rows" must be an object');
  const retired = readRetires(root, id);
  const expected = changeRowIds(root, id).filter((r) => !retired.has(r));
  if (JSON.stringify(Object.keys(rows).sort()) !== JSON.stringify(expected)) {
    fail(`"rows" must list exactly the change's rows minus retired rows: [${expected.join(', ')}]`);
  }
  const values = Object.values(rows);
  if (!values.every((v) => v === 'passes' || v === 'fails')) fail('every row must be "passes" or "fails"');
  if (!Array.isArray(raw.flags) || !raw.flags.every((f) => typeof f === 'string')) fail('"flags" must be a list of strings');
  const problems = behaviourProblems(values.filter((v) => v === 'fails').length, readChange(root, id).noBehaviourChange);
  if (problems.length > 0) fail((problems[0] as string).replace(/^./, (c) => c.toLowerCase()));
  if (raw.inputs_sha256 !== baselineInputs(root, id)) {
    fail('spec-delta.md, tests/ or retires.json changed since the baseline ran, or tests/ holds git-ignored files (inputs_sha256 mismatch)');
  }
}
