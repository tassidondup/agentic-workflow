# ADR 0001: Acceptance Scope and Manifest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the decoy-test bypass found in dogfood run 1. Rows count only from tests under `test.acceptanceDir`. The baseline locks the whole acceptance folder, the `test.harness` paths and the `test` settings. `stage-check` and `trace-check` reject anything the tests gate didn't approve.

**Architecture:** Two new pure modules. `src/acceptance.ts` decides which JUnit test cases count. `src/manifest.ts` builds, parses and checks the acceptance and harness manifest. `run-baseline` writes the manifest into `baseline.json`. `approve` refuses a manifest that doesn't match the tree. `stage-check` compares the live acceptance folder and harness with the manifest. `stage-check` and `trace-check` both re-validate `baseline.json`, so changing the `test` settings after the tests gate (e.g. pointing `acceptanceDir` at `src/`) fails too. `rowOutcomes` moves to `src/outcomes.ts` to avoid an import cycle.

**Tech Stack:** Node ≥22 (local 24.18), TypeScript 5.9.3 strict, Vitest 5.0.3 with `@vitest/coverage-v8`, `fast-xml-parser` 5.11.2. No new dependencies.

**Spec:** `docs/decisions/0001-acceptance-dir-and-manifest.md` (accepted) and `docs/specs/2026-09-29-agentic-workflow-design.md` (v2.4), sections *Test staging, baseline and activation*, *Implementation conventions*, *Edge cases*, *Validation*. Evidence: `docs/research/2026-10-07-wf-dogfood-1.md`.

## Global Constraints
- Node `>=22`, ESM, TypeScript `strict` + `noUncheckedIndexedAccess`. No new runtime dependencies.
- Never run a shell; child processes go through `Exec` (`spawnSync`, `shell: false`).
- Every path read or written stays inside the repo root (use `src/safe-fs.ts` and `assertSafeRepoPath`). Symlinks inside scanned folders are refused, never followed.
- Treat inputs as immutable: `readonly` types, freeze returned objects, never mutate arguments.
- Files ≤ 200 lines where practical; functions < 50 lines.
- Coverage ≥ 80% (lines, branches, functions, statements) via `npm run coverage`.
- Exit codes: `0` check passed, `1` check failed, `2` usage or input error.
- Row ID format `^[A-Z][A-Z0-9]{1,9}-\d{1,4}$`; tests carry the tag `[LST-004]`.
- `test.acceptanceDir` is required and may not overlap `docs/changes/` or contain `test.junitReport`. `test.harness` is required and may be empty.
- A test case's file comes from the JUnit `file` attribute if present, else `classname`. A row-tagged case with no usable path fails closed.
- `baseline.json` gains `acceptance: [{ path, sha256, rows }]` and `harness: [{ path, sha256 | null }]`. `wf` is unreleased (0.1.0, private), so there is no migration: old baselines are invalid.
- Commit messages: `<type>: <description>`, imperative, subject ≤ 50 chars, one logical change per commit, no attribution trailers (disabled in the user's settings).
- Don't push or open a PR unless asked.

## Review Focus
These five input classes aren't on any task's happy path but are the most likely to bite. Each has a pinned test in the task named.
1. **JUnit file paths in odd shapes**: `./` prefixes, backslashes, absolute paths inside and outside the repo, `..` escapes, and a sibling folder sharing the prefix (`tests/acceptance-evil/`). They are normalized or rejected, never credited by string prefix. Tests in Task 2 and Task 6.
2. **A config whose `acceptanceDir` overlaps `docs/changes/` or holds the JUnit report.** Staged tests or the report would be counted as acceptance files. Rejected with a message naming the field. Test in Task 1.
3. **A hand-edited manifest in `baseline.json`** (an entry removed to hide a decoy). `approve tests` refuses it because it no longer matches the tree. Tests in Task 3 and Task 4.
4. **A symlink inside the acceptance folder** at baseline or stage-check time. Refused with "Symlinks are not allowed", never hashed or followed. Test in Task 3.
5. **A row-tagged test case with no file path** (a runner whose reporter omits it). Reported as a problem naming the test; the row counts as not run. Tests in Task 2 and Task 6.

## File Structure
```
src/
  outcomes.ts      NEW  rowOutcomes + RowOutcome (moved from trace.ts; breaks a trace → baseline-file → baseline cycle)
  acceptance.ts    NEW  caseFile(), acceptanceCases(): which JUnit cases count
  manifest.ts      NEW  Manifest types, buildManifest, parseManifest, assertManifestCurrent, manifestProblems
  paths.ts         MOD  isUnderPath()
  hash.ts          MOD  HEX64 (moved from record.ts)
  record.ts        MOD  import HEX64
  junit.ts         MOD  TestCase.file; export rowTags()
  config.ts        MOD  test.acceptanceDir, test.harness; parseTest()
  baseline.ts      MOD  Baseline extends Manifest; BaselineInput.manifest
  baseline-file.ts MOD  validateBaseline() parses and returns the manifest
  run-baseline.ts  MOD  builds the manifest from HEAD; filters cases to the acceptance folder
  approve.ts       MOD  tests gate: assertManifestCurrent
  stage.ts         MOD  stageCheck: manifestProblems + baseline re-validation once the tests gate is valid
  trace.ts         MOD  re-validate baseline; count only acceptance cases; re-export rowOutcomes
  cli.ts           MOD  usage text for trace-check
test/
  acceptance.test.ts, manifest.test.ts   NEW
  helpers/change.ts                      MOD  CONFIG; changeFiles adds it; writeValidBaseline adds the manifest
  helpers/fake-runner.mjs                MOD  classname is the file path; runner.config.json excludeAcceptance; src/decoys.json
  config, junit, baseline, approve, run-baseline, stage, trace, cli, e2e tests   MOD
docs/decisions/0001-…md, docs/specs/2026-09-29-…md, AGENTS.md   MOD (Task 0, Task 7)
```

---

### Task 0: Branch and doc corrections

The ADR claims config drift is "already bound by `inputs_sha256`". It's only checked at approval time. It also says `harness` has a default, which `wf` can't know. Fix both before coding.

**Files:**
- Modify: `docs/decisions/0001-acceptance-dir-and-manifest.md`
- Modify: `docs/specs/2026-09-29-agentic-workflow-design.md` (*Test staging* §2, *Implementation conventions*)

- [ ] **Step 1: Branch**

```bash
git switch main && git pull --ff-only && git switch -c feat/adr-0001-acceptance-scope
```

- [ ] **Step 2: Edit the ADR**

In *Decision* part 2, replace:
```
`wf baseline` records `acceptance: [{ path, sha256 }]` for every file under `acceptanceDir` on HEAD, and `harness: [{ path, sha256 }]` for every path in a new `test.harness` list (default: the runner config file).
```
with:
```
`wf baseline` records `acceptance: [{ path, sha256, rows }]` for every file under `acceptanceDir` on HEAD (`rows`: the row tags in the file, used by the deletion rule), and `harness: [{ path, sha256 }]` for every path in a new, required `test.harness` list (`sha256` is null if the path doesn't exist; the installer fills in the runner config file).
```
In *Consequences → Costs*, replace `Default to the runner config only; projects opt into more.` with `Start with the runner config only; projects opt into more.`

In *Not solved*, replace the bullet that starts `A test command changed in` with:
```
- Changing the `test` settings in `workflow.config.json` after the tests gate (e.g. pointing `acceptanceDir` at `src/`): `inputs_sha256` binds them, but Plan 1 only checked it at approval. The implementation re-validates `baseline.json` in stage-check and trace-check, so drift fails there too. How CI invokes the test command is outside `wf` (Plan 2).
```

- [ ] **Step 3: Edit the design doc**

In *Test staging* §2, replace `plus a manifest (path + sha256) of every file under` with `plus a manifest (path, sha256 and, for acceptance files, the row tags they contain) of every file under`.

In *Implementation conventions*, replace:
```
`acceptanceDir` is required. `harness` defaults to the runner config file; add more paths (e.g. `package.json`) only if their churn is worth the extra re-approvals.
```
with:
```
`acceptanceDir` and `harness` are required (`harness` may be empty). List the runner config file in `harness` (the installer will fill it in) and add more paths (e.g. `package.json`) only if their churn is worth the extra re-approvals. `acceptanceDir` may not overlap `docs/changes/` or contain `junitReport`. Changing any `test` setting after the tests gate makes the baseline stale, which stage-check and trace-check report.
```

- [ ] **Step 4: Commit**

```bash
git add docs/decisions/0001-acceptance-dir-and-manifest.md docs/specs/2026-09-29-agentic-workflow-design.md docs/superpowers/plans/2026-10-07-adr-0001-acceptance-scope.md
git commit -m "docs: plan ADR 0001, pin config and drift"
```

---

### Task 1: Config fields and `isUnderPath`

**Files:**
- Modify: `src/paths.ts`, `src/config.ts`
- Test: `test/paths.test.ts`, `test/config.test.ts`
- Modify fixtures: `test/approve.test.ts:93-94`, `test/run-baseline.test.ts:19,44`, `test/e2e.test.ts:25`

**Interfaces:**
- Produces: `isUnderPath(dir: string, path: string): boolean` in `src/paths.ts`.
- Produces: `TestConfig` with `acceptanceDir: string` and `harness: readonly string[]`; `WorkflowConfig.test: TestConfig`.

- [ ] **Step 1: Write the failing tests**

Append to `test/paths.test.ts` (add `isUnderPath` to the import from `../src/paths.js`):
```ts
describe('isUnderPath', () => {
  it('compares whole path segments', () => {
    expect(isUnderPath('tests/acceptance', 'tests/acceptance')).toBe(true);
    expect(isUnderPath('tests/acceptance', 'tests/acceptance/a.test.ts')).toBe(true);
    expect(isUnderPath('tests/acceptance', 'tests/acceptance-evil/a.test.ts')).toBe(false);
    expect(isUnderPath('tests/acceptance', 'tests')).toBe(false);
  });
});
```

In `test/config.test.ts`, change `good` to:
```ts
const good = {
  approvers: ['tassi'],
  test: { command: ['npx', 'vitest', 'run'], junitReport: 'reports/junit.xml', acceptanceDir: 'tests/acceptance', harness: ['vitest.config.ts'] },
};
```
Add inside `describe('parseConfig', …)`:
```ts
  it('reads acceptanceDir and harness, and allows an empty harness', () => {
    const c = parseConfig(good);
    expect(c.test.acceptanceDir).toBe('tests/acceptance');
    expect(c.test.harness).toEqual(['vitest.config.ts']);
    expect(Object.isFrozen(c.test.harness)).toBe(true);
    expect(parseConfig({ ...good, test: { ...good.test, harness: [] } }).test.harness).toEqual([]);
  });
  it.each([
    ['missing acceptanceDir', { acceptanceDir: undefined }, /"test\.acceptanceDir" must be a repo-relative path/],
    ['unsafe acceptanceDir', { acceptanceDir: '../tests' }, /"test\.acceptanceDir" is not a safe repo path/],
    ['acceptanceDir that holds staging', { acceptanceDir: 'docs' }, /may not overlap docs\/changes/],
    ['acceptanceDir inside staging', { acceptanceDir: 'docs/changes/c1/tests' }, /may not overlap docs\/changes/],
    ['report inside acceptanceDir', { junitReport: 'tests/acceptance/junit.xml' }, /"test\.junitReport" may not be inside "test\.acceptanceDir"/],
    ['missing harness', { harness: undefined }, /"test\.harness" must be a list/],
    ['unsafe harness path', { harness: ['ok.ts', '/etc/passwd'] }, /"test\.harness\[1\]" is not a safe repo path/],
    ['non-string harness path', { harness: [5] }, /"test\.harness\[0\]" must be a repo-relative path/],
  ])('rejects %s (Review Focus 2)', (_name, patch, message) => {
    expect(() => parseConfig({ ...good, test: { ...good.test, ...patch } })).toThrow(message);
  });
```
In the `loadConfig` test that writes a raw config string (line ~51), change the string to:
```ts
    writeFileSync(tmpFile, '{"approvers":["user"],"test":{"command":["npm"],"junitReport":"reports/junit.xml","acceptanceDir":"tests/acceptance","harness":[]}}');
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/paths.test.ts test/config.test.ts`
Expected: FAIL. `isUnderPath` is not exported, and the new `it.each` cases don't throw.

- [ ] **Step 3: Add `isUnderPath` to `src/paths.ts`**

Append:
```ts
/** True if `path` is `dir` or inside it. Compares whole segments, so `tests/acceptance-x` is not inside `tests/acceptance`. */
export const isUnderPath = (dir: string, path: string): boolean => path === dir || path.startsWith(`${dir}/`);
```

- [ ] **Step 4: Replace `src/config.ts`**

```ts
import { readJsonFile } from './change.js';
import { isObject, isStringArray } from './guards.js';
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

export function parseConfig(raw: unknown): WorkflowConfig {
  if (!isObject(raw)) return fail('must be a JSON object');
  const { approvers, test } = raw;
  if (!isStringArray(approvers) || approvers.length === 0 || approvers.some((a) => a.trim() === '')) {
    return fail('"approvers" must be a non-empty list of GitHub usernames');
  }
  return Object.freeze({ approvers: Object.freeze([...approvers]), test: parseTest(test) });
}

export const CONFIG_FILE = 'workflow.config.json';

export const loadConfig = (root: string): WorkflowConfig =>
  parseConfig(readJsonFile(root, CONFIG_FILE));
```

- [ ] **Step 5: Update the other config fixtures**

Every inline config must now carry the two fields:
- `test/approve.test.ts` `config()` helper: `test: { command, junitReport: 'reports/junit.xml', acceptanceDir: 'tests/acceptance', harness: [] }`.
- `test/run-baseline.test.ts` `setup()`: `test: { command: ['node', runner], junitReport: 'reports/junit.xml', acceptanceDir: 'tests/acceptance', harness: [], ...extraConfig }`. The inline config in `refuses when workflow.config.json has uncommitted changes`: add `acceptanceDir: 'tests/acceptance', harness: []`.
- `test/e2e.test.ts` line 25: `test: { command: ['node', runner], junitReport: 'reports/junit.xml', acceptanceDir: 'tests/acceptance', harness: [] }`.

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/paths.ts src/config.ts test/
git commit -m "feat: add acceptanceDir and harness config"
```

---

### Task 2: Test case file identity and acceptance filter

**Files:**
- Create: `src/outcomes.ts`, `src/acceptance.ts`, `test/acceptance.test.ts`
- Modify: `src/trace.ts` (move `rowOutcomes` out, re-export), `src/baseline.ts` (import from `outcomes.js`), `src/junit.ts`
- Test: `test/junit.test.ts`, `test/trace.test.ts:7`, `test/baseline.test.ts:5`

**Interfaces:**
- Produces: `TestCase.file: string` (raw `file` attribute, else `classname`).
- Produces: `rowTags(text: string): string[]` exported from `src/junit.ts`.
- Produces: `rowOutcomes`, `RowOutcome` in `src/outcomes.ts` (also re-exported from `src/trace.ts`).
- Produces: `caseFile(root: string, file: string): string | null` and `acceptanceCases(root: string, dir: string, cases: readonly TestCase[]): ScopedCases` where `interface ScopedCases { readonly cases: readonly TestCase[]; readonly problems: readonly string[] }`.

- [ ] **Step 1: Move `rowOutcomes` to `src/outcomes.ts`** (pure refactor, no behaviour change)

Create `src/outcomes.ts`:
```ts
import type { TestCase } from './junit.js';

export type RowOutcome = 'passes' | 'fails' | 'not-run';

export function rowOutcomes(rowIds: readonly string[], cases: readonly TestCase[]): ReadonlyMap<string, RowOutcome> {
  return new Map(
    rowIds.map((id): [string, RowOutcome] => {
      const executed = cases.filter((c) => c.rowIds.includes(id) && c.status !== 'skipped');
      if (executed.length === 0) return [id, 'not-run'];
      return [id, executed.every((c) => c.status === 'passed') ? 'passes' : 'fails'];
    }),
  );
}
```
In `src/trace.ts`, delete `RowOutcome` and `rowOutcomes` and add near the top:
```ts
import { rowOutcomes } from './outcomes.js';
export { rowOutcomes, type RowOutcome } from './outcomes.js';
```
In `src/baseline.ts`, change `import { rowOutcomes } from './trace.js';` to `import { rowOutcomes } from './outcomes.js';`.

Run: `npx vitest run && npx tsc --noEmit`. Expected: all PASS.

- [ ] **Step 2: Write the failing tests**

In `test/junit.test.ts`, change the expectation in `accepts a single <testsuite> root…` to include `file: 'c'`:
```ts
    expect(parseJUnit(xml)).toEqual([{ name: '[LST-001][LST-002] shared setup', classname: 'c', file: 'c', status: 'passed', rowIds: ['LST-001', 'LST-002'] }]);
```
and add:
```ts
  it('takes each case file from its file attribute, else its classname (ADR 0001)', () => {
    const xml = '<testsuite name="s"><testcase classname="tests/a.test.ts" name="[LST-001] x"/><testcase classname="Suite" file="./tests/b.test.ts" name="[LST-002] y"/></testsuite>';
    expect(parseJUnit(xml).map((c) => c.file)).toEqual(['tests/a.test.ts', './tests/b.test.ts']);
  });
```
Update the `tc` helpers so test cases come from the acceptance folder:
- `test/trace.test.ts:7`: `({ name: rowIds.map((r) => `[${r}]`).join(''), classname: 'tests/acceptance/a.test.ts', file: 'tests/acceptance/a.test.ts', status, rowIds })`
- `test/baseline.test.ts:5`: `({ name: `[${id}]`, classname: 'tests/acceptance/a.test.ts', file: 'tests/acceptance/a.test.ts', status, rowIds: [id] })`

Create `test/acceptance.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { acceptanceCases, caseFile } from '../src/acceptance.js';
import type { TestCase } from '../src/junit.js';

const ROOT = '/work/repo';
const tc = (file: string, rowIds: string[] = ['LST-001']): TestCase =>
  ({ name: `${rowIds.map((r) => `[${r}]`).join('')} t`, classname: file, file, status: 'passed', rowIds });

describe('caseFile (Review Focus 1)', () => {
  it.each([
    ['tests/acceptance/a.test.ts', 'tests/acceptance/a.test.ts'],
    ['./tests/acceptance/a.test.ts', 'tests/acceptance/a.test.ts'],
    ['tests\\acceptance\\a.test.ts', 'tests/acceptance/a.test.ts'],
    ['/work/repo/tests/acceptance/a.test.ts', 'tests/acceptance/a.test.ts'],
    ['tests/acceptance/../../src/decoy.test.ts', 'src/decoy.test.ts'],
  ])('normalizes %j to %j', (raw, want) => {
    expect(caseFile(ROOT, raw)).toBe(want);
  });
  it.each(['', '   ', '/elsewhere/tests/acceptance/a.test.ts', '/work/repo-evil/tests/acceptance/a.test.ts', '../outside.test.ts'])(
    'rejects %j',
    (raw) => {
      expect(caseFile(ROOT, raw)).toBeNull();
    },
  );
});

describe('acceptanceCases', () => {
  it('keeps only cases whose file is inside the acceptance folder', () => {
    const inside = tc('tests/acceptance/a.test.ts');
    const r = acceptanceCases(ROOT, 'tests/acceptance', [inside, tc('src/decoy.test.ts'), tc('tests/acceptance-evil/x.test.ts')]);
    expect(r.cases).toEqual([inside]);
    expect(r.problems).toEqual([]);
  });
  it('reports a row-tagged case with no usable file; untagged ones are ignored (Review Focus 5)', () => {
    const r = acceptanceCases(ROOT, 'tests/acceptance', [tc(''), tc('', [])]);
    expect(r.cases).toEqual([]);
    expect(r.problems).toEqual([
      'Test "[LST-001] t" has no usable file path in the JUnit report (file=""); configure the reporter to record each test\'s file',
    ]);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run test/junit.test.ts test/acceptance.test.ts`
Expected: FAIL. `file` is missing from parsed cases, and `src/acceptance.js` doesn't exist.

- [ ] **Step 4: Update `src/junit.ts`**

Add `readonly file: string;` to `TestCase`. Rename the private `tags` helper and export it:
```ts
/** Row tags like `[LST-004]` found in any text, in order of appearance (may repeat). */
export const rowTags = (text: string): string[] => [...text.matchAll(TAG)].map((m) => m[1] ?? '');
```
Replace both uses of `tags(` with `rowTags(`. In `toCase`, compute the file and include it:
```ts
  const file = String(tc['@_file'] ?? classname);
  return Object.freeze({ name, classname, file, status, rowIds: Object.freeze([...new Set([...rowTags(name), ...rowTags(classname)])]) });
```

- [ ] **Step 5: Create `src/acceptance.ts`**

```ts
import { isAbsolute, posix } from 'node:path';
import type { TestCase } from './junit.js';
import { isUnderPath } from './paths.js';

export interface ScopedCases {
  readonly cases: readonly TestCase[];
  readonly problems: readonly string[];
}

/** Repo-relative path of the file a JUnit test case came from, or null if the report gives none usable. */
export function caseFile(root: string, file: string): string | null {
  let f = file.trim().replaceAll('\\', '/');
  if (f === '') return null;
  if (isAbsolute(f)) {
    const base = `${root.replaceAll('\\', '/')}/`;
    if (!f.startsWith(base)) return null;
    f = f.slice(base.length);
  }
  const n = posix.normalize(f);
  return n === '.' || n === '..' || n.startsWith('../') || n.startsWith('/') ? null : n;
}

/** Keeps only test cases whose file is under the acceptance folder (ADR 0001). A row-tagged case with no usable file is a problem. */
export function acceptanceCases(root: string, dir: string, cases: readonly TestCase[]): ScopedCases {
  const problems = cases
    .filter((c) => c.rowIds.length > 0 && caseFile(root, c.file) === null)
    .map((c) => `Test "${c.name}" has no usable file path in the JUnit report (file="${c.file}"); configure the reporter to record each test's file`);
  const kept = cases.filter((c) => {
    const f = caseFile(root, c.file);
    return f !== null && isUnderPath(dir, f);
  });
  return Object.freeze({ cases: Object.freeze(kept), problems: Object.freeze(problems) });
}
```

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all PASS. Nothing calls `acceptanceCases` yet, so existing behaviour is unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/outcomes.ts src/acceptance.ts src/junit.ts src/trace.ts src/baseline.ts test/
git commit -m "feat: identify each test case's file"
```

---

### Task 3: Manifest build, parse and freshness

**Files:**
- Create: `src/manifest.ts`, `test/manifest.test.ts`
- Modify: `src/hash.ts` (add `HEX64`), `src/record.ts` (import it)

**Interfaces:**
- Consumes: `rowTags` (Task 2), `WorkflowConfig` (Task 1).
- Produces in `src/manifest.ts`:
  - `interface AcceptanceEntry { readonly path: string; readonly sha256: string; readonly rows: readonly string[] }`
  - `interface HarnessEntry { readonly path: string; readonly sha256: string | null }`
  - `interface Manifest { readonly acceptance: readonly AcceptanceEntry[]; readonly harness: readonly HarnessEntry[] }`
  - `buildManifest(root: string, config: WorkflowConfig): Manifest`
  - `parseManifest(raw: Readonly<Record<string, unknown>>): Manifest` (throws `Error` with a plain message)
  - `assertManifestCurrent(root: string, config: WorkflowConfig, manifest: Manifest): void`
- Produces: `HEX64: RegExp` in `src/hash.ts`.

- [ ] **Step 1: Move `HEX64`**

In `src/hash.ts` add `export const HEX64 = /^[0-9a-f]{64}$/;`. In `src/record.ts`, delete its local `HEX64` and import it: `import { canonicalJson, HEX64 } from './hash.js';`.

- [ ] **Step 2: Write the failing tests**

Create `test/manifest.test.ts`:
```ts
import { afterEach, describe, expect, it } from 'vitest';
import { symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { parseConfig } from '../src/config.js';
import { sha256 } from '../src/hash.js';
import { assertManifestCurrent, buildManifest, parseManifest } from '../src/manifest.js';
import { makeRepo, type TestRepo } from './helpers/repo.js';

let repo: TestRepo;
afterEach(() => repo?.cleanup());
const config = (harness: string[] = []) =>
  parseConfig({ approvers: ['tassi'], test: { command: ['node'], junitReport: 'reports/junit.xml', acceptanceDir: 'tests/acceptance', harness } });

describe('buildManifest', () => {
  it('hashes each acceptance file with its row tags, and each harness path (null if absent)', () => {
    const a = "it('[LST-002] b'); it('[LST-001] a'); it('[LST-001] again');";
    repo = makeRepo({
      'tests/acceptance/a.test.ts': a,
      'tests/acceptance/helpers/fixture.ts': 'no tags',
      'vitest.config.ts': 'cfg',
      'src/decoy.test.ts': "it('[LST-001] decoy')",
    });
    expect(buildManifest(repo.root, config(['vitest.config.ts', 'absent.ts']))).toEqual({
      acceptance: [
        { path: 'tests/acceptance/a.test.ts', sha256: sha256(a), rows: ['LST-001', 'LST-002'] },
        { path: 'tests/acceptance/helpers/fixture.ts', sha256: sha256('no tags'), rows: [] },
      ],
      harness: [{ path: 'vitest.config.ts', sha256: sha256('cfg') }, { path: 'absent.ts', sha256: null }],
    });
  });
  it('is empty when the acceptance folder does not exist yet', () => {
    repo = makeRepo();
    expect(buildManifest(repo.root, config())).toEqual({ acceptance: [], harness: [] });
  });
  it('refuses a symlink inside the acceptance folder (Review Focus 4)', () => {
    repo = makeRepo({ 'tests/acceptance/a.test.ts': 't' });
    symlinkSync('/etc/hosts', join(repo.root, 'tests', 'acceptance', 'hosts'));
    expect(() => buildManifest(repo.root, config())).toThrow(/Symlinks are not allowed/);
  });
});

describe('parseManifest', () => {
  const entry = { path: 'tests/acceptance/a.test.ts', sha256: 'a'.repeat(64), rows: ['LST-001'] };
  it('accepts well-formed entries', () => {
    const m = { acceptance: [entry], harness: [{ path: 'vitest.config.ts', sha256: null }] };
    expect(parseManifest(m)).toEqual(m);
  });
  it.each([
    ['missing acceptance', { harness: [] }],
    ['missing harness', { acceptance: [] }],
    ['unsafe path', { acceptance: [{ ...entry, path: '../x' }], harness: [] }],
    ['bad hash', { acceptance: [{ ...entry, sha256: 'xyz' }], harness: [] }],
    ['bad row id', { acceptance: [{ ...entry, rows: ['lst-1'] }], harness: [] }],
    ['harness hash neither hex nor null', { acceptance: [], harness: [{ path: 'a', sha256: 5 }] }],
  ])('rejects %s', (_name, raw) => {
    expect(() => parseManifest(raw)).toThrow(/"(acceptance|harness)" must list/);
  });
});

describe('assertManifestCurrent (Review Focus 3)', () => {
  it('passes for a fresh manifest; fails once an entry is removed by hand or a file changes', () => {
    repo = makeRepo({ 'tests/acceptance/a.test.ts': 't', 'tests/acceptance/decoy.test.ts': 'd' });
    const fresh = buildManifest(repo.root, config());
    expect(() => assertManifestCurrent(repo.root, config(), fresh)).not.toThrow();
    const hidden = { ...fresh, acceptance: fresh.acceptance.filter((e) => !e.path.endsWith('decoy.test.ts')) };
    expect(() => assertManifestCurrent(repo.root, config(), hidden))
      .toThrow(/baseline\.json is stale or invalid: files under tests\/acceptance or test\.harness changed since the baseline ran; re-run wf baseline/);
    repo.write('tests/acceptance/a.test.ts', 'changed');
    expect(() => assertManifestCurrent(repo.root, config(), fresh)).toThrow(/stale or invalid/);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run test/manifest.test.ts`
Expected: FAIL. `src/manifest.js` doesn't exist.

- [ ] **Step 4: Create `src/manifest.ts`**

```ts
import { ROW_ID } from './change.js';
import type { WorkflowConfig } from './config.js';
import { isObject } from './guards.js';
import { canonicalJson, HEX64, sha256 } from './hash.js';
import { rowTags } from './junit.js';
import { assertSafeRepoPath } from './paths.js';
import { listRepoFiles, lstatInRepo, readRepoFile } from './safe-fs.js';

export interface AcceptanceEntry {
  readonly path: string;
  readonly sha256: string;
  readonly rows: readonly string[];
}

export interface HarnessEntry {
  readonly path: string;
  readonly sha256: string | null; // null: the path did not exist when the baseline ran
}

export interface Manifest {
  readonly acceptance: readonly AcceptanceEntry[];
  readonly harness: readonly HarnessEntry[];
}

const fileSha = (root: string, path: string): string | null =>
  lstatInRepo(root, path) === null ? null : sha256(readRepoFile(root, path));

function acceptanceEntry(root: string, path: string): AcceptanceEntry {
  const bytes = readRepoFile(root, path);
  const rows = [...new Set(rowTags(bytes.toString('utf8')))].sort();
  return Object.freeze({ path, sha256: sha256(bytes), rows: Object.freeze(rows) });
}

/** Hashes every file under test.acceptanceDir and every test.harness path, as they are in `root` now. */
export function buildManifest(root: string, config: WorkflowConfig): Manifest {
  const acceptance = listRepoFiles(root, config.test.acceptanceDir).map((p) => acceptanceEntry(root, p));
  const harness = config.test.harness.map((path) => Object.freeze({ path, sha256: fileSha(root, path) }));
  return Object.freeze({ acceptance: Object.freeze(acceptance), harness: Object.freeze(harness) });
}

const isSafePath = (p: unknown): boolean => {
  if (typeof p !== 'string') return false;
  try {
    assertSafeRepoPath(p);
    return true;
  } catch {
    return false;
  }
};
const isHash = (s: unknown): boolean => typeof s === 'string' && HEX64.test(s);
const isAcceptanceEntry = (e: unknown): boolean =>
  isObject(e) && isSafePath(e.path) && isHash(e.sha256) &&
  Array.isArray(e.rows) && e.rows.every((r) => typeof r === 'string' && ROW_ID.test(r));
const isHarnessEntry = (e: unknown): boolean =>
  isObject(e) && isSafePath(e.path) && (e.sha256 === null || isHash(e.sha256));

/** Reads the manifest fields of a parsed baseline.json. Throws a plain message if they are malformed. */
export function parseManifest(raw: Readonly<Record<string, unknown>>): Manifest {
  const { acceptance, harness } = raw;
  if (!Array.isArray(acceptance) || !acceptance.every(isAcceptanceEntry)) {
    throw new Error('"acceptance" must list { path, sha256, rows } entries');
  }
  if (!Array.isArray(harness) || !harness.every(isHarnessEntry)) {
    throw new Error('"harness" must list { path, sha256 } entries (sha256 may be null)');
  }
  return Object.freeze({ acceptance: acceptance as AcceptanceEntry[], harness: harness as HarnessEntry[] });
}

/** Throws unless the manifest equals the acceptance folder and harness as they are in `root` now. */
export function assertManifestCurrent(root: string, config: WorkflowConfig, manifest: Manifest): void {
  const now = canonicalJson(buildManifest(root, config));
  if (now !== canonicalJson({ acceptance: manifest.acceptance, harness: manifest.harness })) {
    throw new Error(
      `baseline.json is stale or invalid: files under ${config.test.acceptanceDir} or test.harness changed since the baseline ran; re-run wf baseline`,
    );
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/manifest.ts src/hash.ts src/record.ts test/manifest.test.ts
git commit -m "feat: build and parse the acceptance manifest"
```

---

### Task 4: Baseline writes, validates and approves the manifest

**Files:**
- Modify: `src/baseline.ts`, `src/baseline-file.ts`, `src/run-baseline.ts`, `src/approve.ts`
- Modify: `test/helpers/change.ts`, `test/helpers/fake-runner.mjs`
- Test: `test/baseline.test.ts`, `test/approve.test.ts`, `test/run-baseline.test.ts`

**Interfaces:**
- Consumes: `Manifest`, `buildManifest`, `parseManifest`, `assertManifestCurrent` (Task 3); `acceptanceCases` (Task 2); `loadConfig` (Task 1).
- Produces: `Baseline extends Manifest`; `BaselineInput.manifest: Manifest`.
- Produces: `validateBaseline(root: string, id: string): Manifest` (was `void`).
- Produces (test helper): `CONFIG: string` exported from `test/helpers/change.ts`; `changeFiles()` includes `workflow.config.json`.

- [ ] **Step 1: Update the test helpers**

`test/helpers/change.ts`: add imports `import { loadConfig } from '../../src/config.js';` and `import { buildManifest } from '../../src/manifest.js';`, then:
```ts
/** A valid workflow.config.json for fixtures: acceptance tests live in tests/acceptance, no harness files. */
export const CONFIG = JSON.stringify({
  approvers: ['tassi'],
  test: { command: ['node', '-e', '0'], junitReport: 'reports/junit.xml', acceptanceDir: 'tests/acceptance', harness: [] },
});
```
In `changeFiles`, add `'workflow.config.json': CONFIG,` as the first entry of the returned object (before `...extra`, so callers can override it). In `writeValidBaseline`, build the body as:
```ts
  const body = { change: id, rows, flags: [], inputs_sha256: baselineInputs(repo.root, id), ...buildManifest(repo.root, loadConfig(repo.root)) };
```

`test/helpers/fake-runner.mjs`: replace the body after the `FAKE_NO_REPORT` line with:
```js
// runner.config.json { "excludeAcceptance": true } simulates a runner config that filters out the acceptance folder.
// src/decoys.json { rows: [{ id, title, file? }] } simulates decoy tests: always pass, reported from `file` (default src/decoys.json).
const readJson = (p, fallback) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : fallback);
const config = readJson('runner.config.json', {});
const spec = config.excludeAcceptance === true ? { rows: [] } : readJson('tests/acceptance/rows.json', { rows: [] });
const decoys = readJson('src/decoys.json', { rows: [] });
const real = spec.rows.map((r) => {
  const pass = r.existing === true || existsSync(`src/impl/${r.id}`);
  const body = pass ? '' : '<failure message="behaviour missing"/>';
  return `<testcase classname="tests/acceptance/rows.json" name="[${r.id}] ${r.title}">${body}</testcase>`;
});
const fake = decoys.rows.map((r) => `<testcase classname="${r.file ?? 'src/decoys.json'}" name="[${r.id}] ${r.title}"></testcase>`);
const cases = [...real, ...fake];
mkdirSync('reports', { recursive: true });
writeFileSync('reports/junit.xml', `<?xml version="1.0"?><testsuites><testsuite name="acceptance">${cases.join('')}</testsuite></testsuites>`);
process.exit(cases.some((c) => c.includes('<failure')) ? 1 : 0);
```
Update the comment at the top of the file to mention both simulations.

- [ ] **Step 2: Write the failing tests**

`test/baseline.test.ts`: add `manifest: { acceptance: [], harness: [] }` to the object `input()` returns; in the first test's `toEqual`, add `acceptance: [], harness: []`. Add:
```ts
  it('carries the manifest into the baseline (ADR 0001)', () => {
    const manifest = {
      acceptance: [{ path: 'tests/acceptance/a.test.ts', sha256: SHA, rows: ['LST-001'] }],
      harness: [{ path: 'vitest.config.ts', sha256: null }],
    };
    const r = computeBaseline({ ...input(['LST-002'], [tc('LST-002', 'failed')]), manifest });
    expect(r.baseline?.acceptance).toEqual(manifest.acceptance);
    expect(r.baseline?.harness).toEqual(manifest.harness);
  });
```

`test/approve.test.ts`: import `loadConfig` from `../src/config.js` and `buildManifest` from `../src/manifest.js`. In `writeBaseline`, build the body as:
```ts
    const body = { change: 'c1', rows: { 'LST-001': 'fails' }, flags: [], inputs_sha256: baselineInputs(repo.root, 'c1'), ...buildManifest(repo.root, loadConfig(repo.root)), ...patch };
```
Add `['no manifest', { acceptance: undefined, harness: undefined }, null],` to the `it.each` list. Add:
```ts
  it('refuses a baseline whose manifest was edited by hand (Review Focus 3)', () => {
    ready({ 'tests/acceptance/old.test.ts': '// [LST-001]', 'tests/acceptance/decoy.test.ts': '// [LST-001] decoy' });
    writeBaseline({ acceptance: [] });
    expect(() => approve(repo.root, 'c1', 'tests')).toThrow(/files under tests\/acceptance or test\.harness changed since the baseline ran/);
    expect(checkGate(repo.root, 'c1', 'tests').status).toBe('missing');
  });
```

`test/run-baseline.test.ts`: import `sha256` from `../src/hash.js`. Add:
```ts
  it('records the acceptance folder and harness from HEAD, before staging (ADR 0001)', () => {
    setup({ harness: ['vitest.config.ts', 'absent.config.ts'] });
    repo.write('tests/acceptance/old.test.ts', '// [LST-001] [LST-001] existing\n');
    repo.write('vitest.config.ts', 'export default {};\n');
    git(repo.root, 'add', '.');
    git(repo.root, 'commit', '-q', '-m', 'existing acceptance test and runner config');
    expect(runBaseline(repo.root, 'c1').problems).toEqual([]);
    const written = JSON.parse(readFileSync(join(repo.root, C, 'baseline.json'), 'utf8'));
    expect(written.acceptance).toEqual([
      { path: 'tests/acceptance/old.test.ts', sha256: sha256('// [LST-001] [LST-001] existing\n'), rows: ['LST-001'] },
    ]);
    expect(written.harness).toEqual([
      { path: 'vitest.config.ts', sha256: sha256('export default {};\n') },
      { path: 'absent.config.ts', sha256: null },
    ]);
  });

  it('ignores row-tagged tests outside the acceptance folder (ADR 0001)', () => {
    setup();
    repo.write('runner.config.json', '{"excludeAcceptance":true}');
    repo.write('src/decoys.json', JSON.stringify({ rows: [{ id: 'LST-001', title: 'decoy' }, { id: 'LST-002', title: 'decoy' }] }));
    git(repo.root, 'add', '.');
    git(repo.root, 'commit', '-q', '-m', 'filter acceptance, add decoys');
    expect(runBaseline(repo.root, 'c1').problems).toEqual(['LST-001: no executed test at baseline', 'LST-002: no executed test at baseline']);
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run test/baseline.test.ts test/approve.test.ts test/run-baseline.test.ts`
Expected: FAIL. The baseline has no `acceptance`/`harness`; the hand-edited manifest is approved; decoys count.

- [ ] **Step 4: Update `src/baseline.ts`**

```ts
import type { TestCase } from './junit.js';
import type { Manifest } from './manifest.js';
import { rowOutcomes } from './outcomes.js';

export interface Baseline extends Manifest {
  readonly change: string;
  readonly rows: Readonly<Record<string, 'passes' | 'fails'>>;
  readonly flags: readonly string[];
  readonly inputs_sha256: string;
}

export interface BaselineInput {
  readonly id: string;
  readonly changeRowIds: readonly string[];
  readonly retired: ReadonlySet<string>;
  readonly live: ReadonlySet<string>;
  readonly cases: readonly TestCase[];
  readonly noBehaviourChange: boolean;
  readonly inputsSha256: string;
  readonly manifest: Manifest;
}
```
Keep `behaviourProblems` and the body of `computeBaseline` unchanged, except the final return:
```ts
  const { acceptance, harness } = input.manifest;
  return {
    baseline: Object.freeze({ change: input.id, rows, flags, inputs_sha256: input.inputsSha256, acceptance, harness }),
    problems: [],
  };
```

- [ ] **Step 5: Update `src/baseline-file.ts`**

Add `import { parseManifest, type Manifest } from './manifest.js';`. Add above `validateBaseline`:
```ts
function manifestOf(raw: Readonly<Record<string, unknown>>): Manifest {
  try {
    return parseManifest(raw);
  } catch (e) {
    return fail((e as Error).message);
  }
}
```
Change `validateBaseline` to return the manifest. Its doc comment becomes `/** Throws unless baseline.json was produced by \`wf baseline\` for the current spec-delta, tests, retirements and test settings; returns its manifest. */`. Its signature becomes `export function validateBaseline(root: string, id: string): Manifest {`. Before the `inputs_sha256` check, add `const manifest = manifestOf(raw);`. Change the inputs failure message to:
```ts
    fail('spec-delta.md, tests/, retires.json or the test settings in workflow.config.json changed since the baseline ran, or tests/ holds git-ignored files (inputs_sha256 mismatch)');
```
End the function with `return manifest;`.

- [ ] **Step 6: Update `src/run-baseline.ts`**

Add imports: `import { acceptanceCases } from './acceptance.js';` and `import { buildManifest } from './manifest.js';`. Change `readInputs` to take the config and record the manifest (still before staging):
```ts
function readInputs(wt: string, id: string, config: WorkflowConfig): Inputs {
  return {
    id,
    changeRowIds: changeRowIds(wt, id),
    retired: readRetires(wt, id),
    live: liveRowIds(wt),
    noBehaviourChange: readChange(wt, id).noBehaviourChange,
    inputsSha256: baselineInputs(wt, id),
    manifest: buildManifest(wt, config),
  };
}
```
In `runBaseline`, replace the lines from `const inputs = …` through `const outcome = …` with:
```ts
    const inputs = readInputs(wt, id, config);
    stageIntoWorktree(wt, id, config.test.junitReport);
    const scoped = acceptanceCases(wt, config.test.acceptanceDir, runTests(exec, config, wt));
    if (scoped.problems.length > 0) return { baseline: null, problems: scoped.problems };
    const outcome = computeBaseline({ ...inputs, cases: scoped.cases });
```

- [ ] **Step 7: Update `src/approve.ts`**

Add imports `import { loadConfig } from './config.js';` and `import { assertManifestCurrent } from './manifest.js';`. Replace `if (gate === 'tests') validateBaseline(root, id);` with:
```ts
  if (gate === 'tests') assertManifestCurrent(root, loadConfig(root), validateBaseline(root, id));
```

- [ ] **Step 8: Run the full suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all PASS. If a test that calls `approveAll` or `approve(…, 'tests')` fails with `workflow.config.json: cannot read file`, its fixture doesn't use `changeFiles()`. Add `'workflow.config.json': CONFIG` to that fixture.

- [ ] **Step 9: Commit**

```bash
git add src/baseline.ts src/baseline-file.ts src/run-baseline.ts src/approve.ts test/
git commit -m "feat: lock acceptance files in the baseline"
```

---

### Task 5: stage-check enforces the manifest and test settings

**Files:**
- Modify: `src/manifest.ts` (add `manifestProblems`), `src/stage.ts`
- Test: `test/manifest.test.ts`, `test/stage.test.ts`

**Interfaces:**
- Consumes: `validateBaseline(root, id): Manifest` (Task 4), `loadConfig`, `readRetires`, `stagedFiles`.
- Produces: `interface ImplementationScope { readonly staged: ReadonlySet<string>; readonly retired: ReadonlySet<string> }` and `manifestProblems(root: string, config: WorkflowConfig, manifest: Manifest, scope: ImplementationScope): string[]` in `src/manifest.ts`.

- [ ] **Step 1: Write the failing unit tests**

Append to `test/manifest.test.ts` (add `manifestProblems` to the import and `rmSync` to the `node:fs` import):
```ts
describe('manifestProblems (ADR 0001)', () => {
  const cfg = config(['vitest.config.ts', 'absent.ts']);
  const scope = (staged: string[] = [], retired: string[] = []) => ({ staged: new Set(staged), retired: new Set(retired) });
  const atGate = () => {
    repo = makeRepo({ 'tests/acceptance/old.test.ts': '// [LST-001] [LST-009]', 'vitest.config.ts': 'cfg' });
    return buildManifest(repo.root, cfg);
  };

  it('passes when the live folder is the manifest plus staged files', () => {
    const m = atGate();
    repo.write('tests/acceptance/new.test.ts', 'staged');
    expect(manifestProblems(repo.root, cfg, m, scope(['tests/acceptance/new.test.ts']))).toEqual([]);
  });

  it('flags a file nobody approved (a decoy inside the folder)', () => {
    const m = atGate();
    repo.write('tests/acceptance/decoy.test.ts', '// [LST-001]');
    expect(manifestProblems(repo.root, cfg, m, scope())).toEqual([
      'tests/acceptance/decoy.test.ts is not approved: it was not in tests/acceptance at the tests gate and this change does not stage it',
    ]);
  });

  it('flags an edited older acceptance test unless this change staged it', () => {
    const m = atGate();
    repo.write('tests/acceptance/old.test.ts', '// loosened');
    expect(manifestProblems(repo.root, cfg, m, scope())).toEqual(['tests/acceptance/old.test.ts changed since the tests gate']);
    expect(manifestProblems(repo.root, cfg, m, scope(['tests/acceptance/old.test.ts']))).toEqual([]);
  });

  it('allows deleting an acceptance file only when all its rows are retired', () => {
    const m = atGate();
    rmSync(join(repo.root, 'tests', 'acceptance', 'old.test.ts'));
    expect(manifestProblems(repo.root, cfg, m, scope())).toEqual([
      'tests/acceptance/old.test.ts was deleted, but its rows LST-001, LST-009 are not retired',
    ]);
    expect(manifestProblems(repo.root, cfg, m, scope([], ['LST-001']))).toEqual([
      'tests/acceptance/old.test.ts was deleted, but its rows LST-009 are not retired',
    ]);
    expect(manifestProblems(repo.root, cfg, m, scope([], ['LST-001', 'LST-009']))).toEqual([]);
  });

  it('flags a harness file that changed, appeared or vanished, unless staged', () => {
    const m = atGate();
    repo.write('vitest.config.ts', "exclude: ['tests/acceptance/**']");
    repo.write('absent.ts', 'new');
    expect(manifestProblems(repo.root, cfg, m, scope())).toEqual([
      'vitest.config.ts (test harness) changed since the tests gate',
      'absent.ts (test harness) changed since the tests gate',
    ]);
    expect(manifestProblems(repo.root, cfg, m, scope(['vitest.config.ts', 'absent.ts']))).toEqual([]);
    rmSync(join(repo.root, 'vitest.config.ts'));
    expect(manifestProblems(repo.root, cfg, m, scope([], []))[0]).toBe('vitest.config.ts (test harness) changed since the tests gate');
  });
});
```

Add to `test/stage.test.ts` (import `CONFIG` from `./helpers/change.js`):
```ts
  it('stageCheck covers the whole acceptance folder and the test settings once the tests gate is valid (ADR 0001)', () => {
    repo = makeRepo(changeFiles());
    approveAll(repo);
    promote(repo.root, 'c1', 'tests');
    expect(stageCheck(repo.root, 'c1')).toEqual([]);
    repo.write('tests/acceptance/decoy.test.ts', '// [LST-001]');
    expect(stageCheck(repo.root, 'c1')).toEqual([
      'tests/acceptance/decoy.test.ts is not approved: it was not in tests/acceptance at the tests gate and this change does not stage it',
    ]);
    rmSync(join(repo.root, 'tests', 'acceptance', 'decoy.test.ts'));
    repo.write('workflow.config.json', CONFIG.replace('"tests/acceptance"', '"src"'));
    expect(stageCheck(repo.root, 'c1')).toEqual([expect.stringMatching(/baseline\.json is stale or invalid: .*inputs_sha256 mismatch/)]);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/manifest.test.ts test/stage.test.ts`
Expected: FAIL. `manifestProblems` doesn't exist and `stageCheck` returns `[]` for the decoy.

- [ ] **Step 3: Add `manifestProblems` to `src/manifest.ts`**

```ts
export interface ImplementationScope {
  readonly staged: ReadonlySet<string>; // live paths this change's approved staging writes
  readonly retired: ReadonlySet<string>;
}

function deletionProblems(manifest: Manifest, live: ReadonlySet<string>, scope: ImplementationScope): string[] {
  return manifest.acceptance
    .filter((e) => !live.has(e.path) && !scope.staged.has(e.path))
    .flatMap((e) => {
      const kept = e.rows.filter((r) => !scope.retired.has(r));
      return kept.length === 0 ? [] : [`${e.path} was deleted, but its rows ${kept.join(', ')} are not retired`];
    });
}

/**
 * ADR 0001: outside this change's staging, the acceptance folder must equal the manifest (a file may
 * be deleted only if all its rows are retired), and every harness path must still hash the same.
 */
export function manifestProblems(root: string, config: WorkflowConfig, manifest: Manifest, scope: ImplementationScope): string[] {
  const dir = config.test.acceptanceDir;
  const approved = new Map(manifest.acceptance.map((e) => [e.path, e.sha256]));
  const live = listRepoFiles(root, dir).filter((p) => !scope.staged.has(p));
  const unapproved = live
    .filter((p) => !approved.has(p))
    .map((p) => `${p} is not approved: it was not in ${dir} at the tests gate and this change does not stage it`);
  const edited = live
    .filter((p) => approved.has(p) && fileSha(root, p) !== approved.get(p))
    .map((p) => `${p} changed since the tests gate`);
  const harness = manifest.harness
    .filter((h) => !scope.staged.has(h.path) && fileSha(root, h.path) !== h.sha256)
    .map((h) => `${h.path} (test harness) changed since the tests gate`);
  return [...unapproved, ...edited, ...deletionProblems(manifest, new Set(live), scope), ...harness];
}
```

- [ ] **Step 4: Update `stageCheck` in `src/stage.ts`**

Add imports:
```ts
import { validateBaseline } from './baseline-file.js';
import { readRetires } from './change.js';
import { loadConfig } from './config.js';
import { manifestProblems } from './manifest.js';
```
(merge `readRetires` into the existing `./change.js` import). Replace `stageCheck` with:
```ts
// Re-validating baseline.json catches test settings changed after the gate (inputs_sha256); the
// manifest check catches decoys, edits and unretired deletions in the acceptance folder and harness.
function acceptanceProblems(root: string, id: string): string[] {
  try {
    const manifest = validateBaseline(root, id);
    const staged = new Set(STAGE_GATES.flatMap((g) => stagedFiles(root, id, g).map((f) => f.livePath)));
    return manifestProblems(root, loadConfig(root), manifest, { staged, retired: readRetires(root, id) });
  } catch (e) {
    return [(e as Error).message];
  }
}

/**
 * stage-check: the design and tests gates must always be valid (so deleting staging after
 * approval can't hide a loosened live file), live files must equal their staged bytes, and
 * (once the tests gate is valid) the acceptance folder and harness must match the baseline manifest.
 */
export function stageCheck(root: string, id: string): string[] {
  assertChangeExists(root, id);
  const gates = STAGE_GATES.map((g) => ({ g, status: checkGate(root, id, g).status }));
  const problems = gates.flatMap(({ g, status }) => {
    const invalid = status === 'valid' ? [] : [`${g} gate is ${status}`];
    const mismatches = checkStage(root, id, g).map((m) => `${g}: ${m.livePath} is ${m.reason === 'missing' ? 'missing' : 'different from approved staging'}`);
    return [...invalid, ...mismatches];
  });
  const testsValid = gates.some(({ g, status }) => g === 'tests' && status === 'valid');
  return [...problems, ...(testsValid ? acceptanceProblems(root, id) : [])];
}
```

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all PASS, including the existing `stageCheck` tests. Their expectations don't change, because the manifest check only runs once the tests gate is valid, and a valid gate with promoted staging has no extra files.

- [ ] **Step 6: Commit**

```bash
git add src/manifest.ts src/stage.ts test/manifest.test.ts test/stage.test.ts
git commit -m "feat: stage-check the whole acceptance folder"
```

---

### Task 6: trace-check counts only acceptance tests

**Files:**
- Modify: `src/trace.ts`, `src/cli.ts` (usage line)
- Test: `test/trace.test.ts`, `test/cli.test.ts:93,100`

**Interfaces:**
- Consumes: `acceptanceCases` (Task 2), `validateBaseline` (Task 4), `loadConfig`.
- Produces: `traceImplementation(required, cases, scope?: string)`; problem text `"<ROW>: no executed test under <scope>"` when a scope is given.

- [ ] **Step 1: Write the failing tests**

In `test/trace.test.ts`, import `CONFIG` from `./helpers/change.js`. Add to `describe('traceImplementation')`:
```ts
  it('names the folder when a scope is given', () => {
    expect(traceImplementation(['B-2'], [], 'tests/acceptance').problems).toEqual(['B-2: no executed test under tests/acceptance']);
  });
```
Add to `describe('traceCheck (I3)')`:
```ts
  it('counts only tests under the acceptance folder (ADR 0001, Review Focus 1)', () => {
    repo = makeRepo(changeFiles());
    approveAll(repo);
    const decoy = { ...tc(['LST-001'], 'passed'), classname: 'src/decoy.test.ts', file: 'src/decoy.test.ts' };
    const sibling = { ...decoy, classname: 'tests/acceptance-evil/x.test.ts', file: 'tests/acceptance-evil/x.test.ts' };
    expect(traceCheck(repo.root, 'c1', [decoy, sibling])).toEqual(['LST-001: no executed test under tests/acceptance']);
  });
  it('fails closed on a row-tagged test with no file path (Review Focus 5)', () => {
    repo = makeRepo(changeFiles());
    approveAll(repo);
    const blind = { ...tc(['LST-001'], 'passed'), classname: '', file: '' };
    expect(traceCheck(repo.root, 'c1', [blind])).toEqual([
      'Test "[LST-001]" has no usable file path in the JUnit report (file=""); configure the reporter to record each test\'s file',
      'LST-001: no executed test under tests/acceptance',
    ]);
  });
  it('fails when the test settings changed after the tests gate (ADR 0001)', () => {
    repo = makeRepo(changeFiles());
    approveAll(repo);
    repo.write('workflow.config.json', CONFIG.replace('"tests/acceptance"', '"src"'));
    expect(traceCheck(repo.root, 'c1', pass)).toEqual([expect.stringMatching(/baseline\.json is stale or invalid: .*inputs_sha256 mismatch/)]);
  });
```
In `test/cli.test.ts`, change `classname="c"` to `classname="tests/acceptance/a.test.ts"` in both JUnit strings (lines ~93 and ~100).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/trace.test.ts`
Expected: FAIL. Decoys still count, and the config change isn't detected.

- [ ] **Step 3: Update `src/trace.ts`**

Add imports:
```ts
import { acceptanceCases } from './acceptance.js';
import { validateBaseline } from './baseline-file.js';
import { loadConfig } from './config.js';
```
Replace `traceImplementation` and `traceCheck` with:
```ts
export function traceImplementation(required: readonly string[], cases: readonly TestCase[], scope?: string): { ok: boolean; problems: readonly string[] } {
  const where = scope === undefined ? '' : ` under ${scope}`;
  const problems = [...rowOutcomes(required, cases)]
    .filter(([, o]) => o !== 'passes')
    .map(([r, o]) => `${r}: ${o === 'not-run' ? `no executed test${where}` : 'failing'}`);
  return { ok: problems.length === 0, problems };
}

/** The acceptance folder from the approved test settings, or the problem that makes them untrustworthy. */
function approvedAcceptanceDir(root: string, id: string): { dir: string } | { problem: string } {
  try {
    validateBaseline(root, id);
    return { dir: loadConfig(root).test.acceptanceDir };
  } catch (e) {
    return { problem: (e as Error).message };
  }
}

/**
 * trace-check: the tests gate must be valid (it binds spec, design and retires.json) and the test
 * settings must match the baseline; then every required row must pass in a test under the acceptance folder.
 */
export function traceCheck(root: string, id: string, cases: readonly TestCase[]): readonly string[] {
  assertChangeExists(root, id);
  const tests = checkGate(root, id, 'tests');
  if (tests.status !== 'valid') return [`tests gate is ${tests.status}; retirements and rows are not approved`];
  const scope = approvedAcceptanceDir(root, id);
  if ('problem' in scope) return [scope.problem];
  const malformed = [...liveRows(root), ...changeRows(root, id)]
    .filter((r) => !ROW_ID.test(r.id))
    .map((r) => `Malformed row ID "${r.id}" in ${r.file}:${r.line}`);
  const scoped = acceptanceCases(root, scope.dir, cases);
  return [...malformed, ...scoped.problems, ...traceImplementation(requiredRows(root, id), scoped.cases, scope.dir).problems];
}
```

- [ ] **Step 4: Update the usage line in `src/cli.ts`**

```ts
  trace-check <id> --report <path>     every required row must have an executed, passing test under test.acceptanceDir
```

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/trace.ts src/cli.ts test/trace.test.ts test/cli.test.ts
git commit -m "feat: trace-check only counts acceptance tests"
```

---

### Task 7: End-to-end attack test, coverage and status

**Files:**
- Test: `test/e2e.test.ts`
- Modify: `docs/decisions/0001-acceptance-dir-and-manifest.md` (*Follow-up*), `AGENTS.md` (*Status*)

**Interfaces:**
- Consumes: the CLI (`run`), the fake runner from Task 4 (`runner.config.json`, `src/decoys.json`).

- [ ] **Step 1: Write the end-to-end test**

In `test/e2e.test.ts`, add `import { rmSync } from 'node:fs';` and `import { join, resolve } from 'node:path';` (replacing the `resolve`-only import). Add inside `describe('full change lifecycle', …)`:
```ts
  it('rejects every dogfood attack with no implementation (ADR 0001)', () => {
    const id = 'listing-price-limits';
    const config = (acceptanceDir: string): string => JSON.stringify({
      approvers: ['tassi'],
      test: { command: ['node', runner], junitReport: 'reports/junit.xml', acceptanceDir, harness: ['runner.config.json'] },
    });
    repo = makeRepo({
      'workflow.config.json': config('tests/acceptance'),
      'runner.config.json': '{"excludeAcceptance":false}',
      'docs/context.md': '# Context\n', 'docs/glossary.md': '# Glossary\n',
      'docs/specs/listing/spec.md': '| ID | Price | Expected |\n|---|---|---|\n| LST-001 | 999999 | 201 |\n',
      'tests/acceptance/old.test.ts': '// [LST-001] accepts max\n',
      [`${C}/proposal.md`]: 'Limit prices.',
      [`${C}/change.json`]: '{"level":"P1","noBehaviourChange":false}',
      [`${C}/spec-delta.md`]: '| ID | Price | Expected |\n|---|---|---|\n| LST-002 | 0 | 422 |\n',
      [`${C}/design/design.md`]: 'Validate price in the API.',
      [`${C}/tests/stage/tests/acceptance/rows.json`]: JSON.stringify({ rows: [
        { id: 'LST-001', title: 'accepts max', existing: true },
        { id: 'LST-002', title: 'rejects 0' },
      ] }),
    });
    git(repo.root, 'init', '-q', '-b', 'main');
    commit('init');
    expect(wf('approve', id, 'spec').code).toBe(0);
    expect(wf('approve', id, 'design').code).toBe(0);
    commit('spec and design gates');
    expect(wf('baseline', id).code).toBe(0);
    expect(wf('approve', id, 'tests').code).toBe(0);
    expect(wf('promote', id, 'tests').code).toBe(0);
    const trace = (): { code: number; out: string } => {
      spawnSync('node', [runner], { cwd: repo.root });
      return wf('trace-check', id, '--report', 'reports/junit.xml');
    };

    // Honest state, no implementation: the real row fails and nothing else is wrong.
    expect(trace().out).toMatch(/LST-002: failing/);
    expect(wf('stage-check', id).code).toBe(0);

    // The dogfood bypass: exclude the acceptance folder in the runner config, add passing decoys outside it.
    repo.write('runner.config.json', '{"excludeAcceptance":true}');
    repo.write('src/decoys.json', JSON.stringify({ rows: [{ id: 'LST-001', title: 'decoy' }, { id: 'LST-002', title: 'decoy' }] }));
    const bypass = trace();
    expect(bypass.code).toBe(1);
    expect(bypass.out).toMatch(/LST-002: no executed test under tests\/acceptance/);
    expect(wf('stage-check', id).out).toMatch(/runner\.config\.json \(test harness\) changed since the tests gate/);

    // A decoy file inside the acceptance folder.
    repo.write('tests/acceptance/decoy.test.ts', '// [LST-002] decoy\n');
    expect(wf('stage-check', id).out).toMatch(/tests\/acceptance\/decoy\.test\.ts is not approved/);

    // An older live acceptance test is loosened, then deleted without retiring its row.
    repo.write('tests/acceptance/old.test.ts', '// [LST-001] loosened\n');
    expect(wf('stage-check', id).out).toMatch(/tests\/acceptance\/old\.test\.ts changed since the tests gate/);
    rmSync(join(repo.root, 'tests', 'acceptance', 'old.test.ts'));
    expect(wf('stage-check', id).out).toMatch(/old\.test\.ts was deleted, but its rows LST-001 are not retired/);

    // The acceptance folder is repointed at src/ after the tests gate.
    repo.write('workflow.config.json', config('src'));
    expect(trace().out).toMatch(/baseline\.json is stale or invalid: .*inputs_sha256 mismatch/);
  });
```

- [ ] **Step 2: Run it**

Run: `npx vitest run test/e2e.test.ts`
Expected: PASS (Tasks 1–6 implement every check it exercises). If it fails, the failure names the attack that got through: fix the implementation, not the test.

- [ ] **Step 3: Coverage, typecheck, build**

Run: `npm run coverage && npx tsc --noEmit && npm run build`
Expected: coverage ≥ 80% on all four measures, no type errors, build succeeds.

- [ ] **Step 4: Update the ADR and status**

In `docs/decisions/0001-acceptance-dir-and-manifest.md`:
- Change the status line to `**Status:** Accepted (2026-10-07). Implemented (plan \`docs/superpowers/plans/2026-10-07-adr-0001-acceptance-scope.md\`).`
- Replace the `- To do: implement as a small plan…` bullet with `- Done: implemented with an adversarial test for each attack (\`test/e2e.test.ts\`, "rejects every dogfood attack").`

In `AGENTS.md` *Status*, replace `Next: implement ADR 0001 (\`docs/decisions/0001-acceptance-dir-and-manifest.md\`, the decoy-test fix from dogfood run 1), then Plan 2` with `ADR 0001 (decoy-test fix) is implemented. Next: Plan 2`.

- [ ] **Step 5: Commit**

```bash
git add test/e2e.test.ts docs/decisions/0001-acceptance-dir-and-manifest.md AGENTS.md
git commit -m "test: reject dogfood attacks end to end"
```

- [ ] **Step 6: Hand back**

Report the test count, coverage numbers and commit list. Don't push. Suggest `/codex:adversarial-review` on the branch before the PR (this change is security-relevant).
