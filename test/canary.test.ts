import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CANARY_PLACEHOLDER, canaryName, canaryProblems, isNonce, removeCanary, writeCanary } from '../src/canary.js';
import type { CanaryConfig } from '../src/config.js';
import type { TestCase } from '../src/junit.js';
import { makeRepo, type TestRepo } from './helpers/repo.js';

let repo: TestRepo;
afterEach(() => repo?.cleanup());

const NONCE = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const CANARY: CanaryConfig = { template: 'tests/harness/canary.template.ts', path: 'tests/acceptance/canary.test.ts' };
const TEMPLATE = `import { it, expect } from 'vitest';\nit('[canary:${CANARY_PLACEHOLDER}]', () => expect(1).toBe(2));\n`;

const kase = (patch: Partial<TestCase> = {}): TestCase => ({
  name: canaryName(NONCE),
  classname: CANARY.path,
  file: CANARY.path,
  status: 'failed',
  rowIds: [],
  ...patch,
});
const problems = (cases: TestCase[], nonce = NONCE): readonly string[] => canaryProblems('/repo', CANARY, cases, nonce);

describe('isNonce', () => {
  it.each(['a1b2c3d4e5f60718', NONCE, 'f'.repeat(64)])('accepts %s', (n) => expect(isNonce(n)).toBe(true));
  it.each(['', 'short', 'A1B2C3D4E5F60718', 'g'.repeat(32), 'a'.repeat(65), `${NONCE}\n`, `${NONCE}]; rm`])('rejects %j', (n) => expect(isNonce(n)).toBe(false));
});

describe('writeCanary', () => {
  it('writes the template to the canary path with the nonce filled in', () => {
    repo = makeRepo({ [CANARY.template]: TEMPLATE });
    writeCanary(repo.root, CANARY, NONCE);
    expect(readFileSync(join(repo.root, CANARY.path), 'utf8')).toBe(TEMPLATE.replaceAll(CANARY_PLACEHOLDER, NONCE));
  });
  it('refuses a template that has no placeholder', () => {
    repo = makeRepo({ [CANARY.template]: "it('x', () => {});\n" });
    expect(() => writeCanary(repo.root, CANARY, NONCE)).toThrow(/does not contain __WF_CANARY_NONCE__/);
    expect(existsSync(join(repo.root, CANARY.path))).toBe(false);
  });
  it('refuses a missing template', () => {
    repo = makeRepo();
    expect(() => writeCanary(repo.root, CANARY, NONCE)).toThrow();
  });
  it('refuses a bad nonce before touching anything', () => {
    repo = makeRepo({ [CANARY.template]: TEMPLATE });
    expect(() => writeCanary(repo.root, CANARY, 'nope')).toThrow(/nonce/);
    expect(existsSync(join(repo.root, CANARY.path))).toBe(false);
  });
  it('removeCanary deletes the written file and tolerates a missing one', () => {
    repo = makeRepo({ [CANARY.template]: TEMPLATE });
    writeCanary(repo.root, CANARY, NONCE);
    removeCanary(repo.root, CANARY);
    expect(existsSync(join(repo.root, CANARY.path))).toBe(false);
    expect(() => removeCanary(repo.root, CANARY)).not.toThrow();
  });
});

describe('canaryProblems', () => {
  it('accepts exactly one failed canary in the canary file', () => {
    expect(problems([kase(), kase({ name: 'other', file: 'tests/acceptance/a.test.ts', status: 'passed' })])).toEqual([]);
  });
  it('accepts an absolute file path under the repo root', () => {
    expect(problems([kase({ file: `/repo/${CANARY.path}` })])).toEqual([]);
  });
  it.each([
    ['missing', [] as TestCase[]],
    ['passed (assertions disabled)', [kase({ status: 'passed' })]],
    ['skipped (filtered)', [kase({ status: 'skipped' })]],
    ['duplicated', [kase(), kase()]],
    ['reported from another file', [kase({ file: 'tests/acceptance/other.test.ts' })]],
    ['reported with no file', [kase({ file: '' })]],
    ['carrying a different nonce', [kase({ name: canaryName('f'.repeat(32)) })]],
  ])('rejects a canary that is %s', (_label, cases) => {
    const found = problems(cases);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/canary/);
    expect(found[0]).toMatch(/cannot be trusted/);
  });
});
