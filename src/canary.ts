import { caseFile } from './acceptance.js';
import type { CanaryConfig } from './config.js';
import type { TestCase } from './junit.js';
import { readRepoFile, removeRepoFile, writeRepoFile } from './safe-fs.js';

/** The marker a canary template carries; `wf` swaps it for this run's nonce. */
export const CANARY_PLACEHOLDER = '__WF_CANARY_NONCE__';

const NONCE = /^[0-9a-f]{16,64}$/;
export const isNonce = (value: string): boolean => NONCE.test(value);

/** The test name a canary carries in the JUnit report. */
export const canaryName = (nonce: string): string => `[canary:${nonce}]`;

/** Writes the must-fail test from its locked template, with this run's nonce in its name. */
export function writeCanary(root: string, canary: CanaryConfig, nonce: string): void {
  if (!isNonce(nonce)) throw new Error('The canary nonce must be 16 to 64 lowercase hex characters');
  const template = readRepoFile(root, canary.template, 'utf8');
  if (!template.includes(CANARY_PLACEHOLDER)) {
    throw new Error(`${canary.template} does not contain ${CANARY_PLACEHOLDER}, so the canary test would not carry the nonce`);
  }
  writeRepoFile(root, canary.path, template.replaceAll(CANARY_PLACEHOLDER, nonce));
}

export const removeCanary = (root: string, canary: CanaryConfig): void => removeRepoFile(root, canary.path);

/**
 * The report is trustworthy only if the canary ran and failed: exactly one case carries this run's nonce, it comes
 * from the canary file, and its status is failed. Missing, passing, skipped or duplicated means something disabled
 * the assertions, filtered the file or rewrote the report. An empty result means the canary behaved.
 */
export function canaryProblems(root: string, canary: CanaryConfig, cases: readonly TestCase[], nonce: string): readonly string[] {
  const name = canaryName(nonce);
  const found = cases.filter((c) => c.name.includes(name));
  const bad = (why: string): readonly string[] => [`The canary ${name} ${why}, so this report cannot be trusted`];
  if (found.length === 0) return bad('is not in the report');
  if (found.length > 1) return bad(`appears ${found.length} times`);
  const [only] = found;
  if (only === undefined) return bad('is not in the report');
  if (caseFile(root, only.file) !== canary.path) return bad(`was reported from ${only.file === '' ? 'no file' : only.file}, not ${canary.path}`);
  if (only.status !== 'failed') return bad(`${only.status} instead of failing`);
  return [];
}
