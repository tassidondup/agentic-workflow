# wf Core Gate Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `wf` command-line tool that makes the workflow's guarantees mechanical. It covers chained hash-bound approval records, gate checks, test and design staging with byte-identity, baseline runs, trace checks, spec lint and memory checks.

**Architecture:** A dependency-light TypeScript CLI. Each check is a small pure module that reads the repo from disk and returns data; `cli.ts` turns that data into output and exit codes. Anything that runs other programs goes through one injectable `Exec` function, so tests can use real git in temp repos without touching your machine.

**Tech Stack:** Node ≥22 (local: 24.18), TypeScript 5.9.3, Vitest 5.0.3 with `@vitest/coverage-v8` 5.0.3, `fast-xml-parser` 5.11.2 (the only runtime dependency), npm.

**Spec:** `docs/specs/2026-09-29-agentic-workflow-design.md` (v2.2). Task 0 amends it where this plan pins down details the spec left open.

## Where this plan sits (roadmap)
The spec covers five subsystems. Each gets its own plan, in this order:
1. **This plan: `wf` core gate engine.** It's the trust core every other part calls, and it doesn't depend on any unproven runtime.
2. **GitHub enforcement.** Provenance check (was the record merged by an approver?) via the GitHub API, CI workflow templates, CODEOWNERS, ruleset and bot-identity setup guide.
3. **Installer.** `wf init` / `wf upgrade`, the managed AGENTS.md block, the `.workflow/` layout and templates.
4. **Team layer.** `roles/*.md` → `gen-roles`, hooks (owned paths, gate check, verify), the cross-provider Codex runner, and orchestrator instructions. Preceded by **Spike S**, a throwaway half-day probe of agent teams + per-builder worktrees + hooks firing for teammates + Codex CLI from a teammate. Spike S can run in parallel with this plan.
5. **Trial 1.** One P1 change through the whole team on the greenfield pilot.

## Global Constraints
- Node `>=22`, ESM (`"type": "module"`), TypeScript `strict` + `noUncheckedIndexedAccess`.
- Runtime dependencies: `fast-xml-parser` only. Pin exact versions (`--save-exact`).
- Never run a shell. Child processes go through `spawnSync(cmd, args, { shell: false })`, and config commands are string arrays.
- Every path read or written must stay inside the repo root. Reject absolute paths, `..`, empty segments and backslashes. Refuse symlinks inside gated or staged folders.
- Staged files may never target `docs/changes/`, `.git/`, `.github/` or `.workflow/`.
- Treat inputs as immutable: `readonly` types, no mutation of arguments, freeze parsed config.
- Files ≤ 200 lines where practical (800 max); functions < 50 lines.
- Test coverage ≥ 80% (lines, branches, functions, statements), enforced by `npm run coverage`.
- Exit codes: `0` check passed, `1` check failed, `2` usage or input error.
- Commit messages: `<type>: <description>`, imperative, subject ≤ 50 chars, one logical change per commit. No attribution trailers (disabled in the user's settings).
- Row ID format: `^[A-Z][A-Z0-9]{1,9}-\d{1,4}$` (e.g. `LST-004`). Test names carry the tag `[LST-004]`.
- Change ID format: `^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$`; folder `docs/changes/<id>/`.

## Review Focus
These five input classes aren't central to any one task's happy path but are the most likely to bite. Each has a pinned test in the task named.
1. **A symlink inside a gated or staged folder** (e.g. pointing at `~/.ssh`) is refused with a clear error and never hashed or copied. Tests in Task 2 and Task 8.
2. **A malformed or hand-edited approval record, config or `change.json`** (truncated JSON, wrong gate name, bad hash, empty approvers) is reported invalid or exits `2`, naming the file. It is never "valid". Tests in Tasks 3, 5 and 6.
3. **The test command exits without writing the JUnit report** (reporter not configured, crash). The baseline errors; it never records every row as failing. Test in Task 12.
4. **JUnit report shapes from different runners**: nested suites, a single `<testsuite>` root, a test tagged with two row IDs, skipped tests. All parse correctly, and skipped never counts as executed. Tests in Tasks 10 and 11.
5. **A file added to a gated folder after approval** (a new mockup, a new staged test) makes the gate `changed` and names the added path. Test in Task 6.

## File Structure
```
package.json, package-lock.json, tsconfig.json, tsconfig.build.json, vitest.config.ts
.github/workflows/ci.yml        typecheck + coverage on push/PR
src/
  types.ts        Gate, ApprovalRecord, GateResult, StageGate, PREREQS
  version.ts      TOOL_VERSION
  guards.ts       isObject, isStringArray
  hash.ts         sha256, sha256File, canonicalJson
  paths.ts        change ids, repo-path safety, changeDir, listFiles (no symlinks)
  config.ts       workflow.config.json loader/validator
  change.ts       change.json + retires.json readers
  coverage.ts     which files each gate covers
  record.ts       build/read/write approval records
  gate-check.ts   chained gate validation
  approve.ts      approve a gate (refuses if upstream invalid)
  stage.ts        staged files, byte-identity check, promote
  rows.ts         markdown example-table parser
  spec-index.ts   liveRowIds, changeRowIds, openChangeIds
  spec-lint.ts    duplicate/malformed/conflicting/colliding rows
  junit.ts        JUnit XML → TestCase[]
  trace.ts        row outcomes, implementation trace
  baseline.ts     compute baseline from outcomes
  exec.ts         Exec type + realExec (spawnSync, no shell)
  run-baseline.ts temp worktree → promote → run tests → baseline.json
  memory-check.ts context.md / glossary / decisions-audit checks
  cli.ts          argument parsing → modules → output + exit code
  bin.ts          process entry
test/
  helpers/repo.ts         temp repo builder + git helper
  helpers/fake-runner.mjs fake test runner that writes JUnit
  <module>.test.ts        one per module; e2e.test.ts for the full flow
```

---

### Task 0: Baseline commit, branch, and spec amendments

**Files:**
- Modify: `docs/specs/2026-09-29-agentic-workflow-design.md`

**Interfaces:**
- Consumes: nothing.
- Produces: the conventions every later task relies on (staging mirror layout, `change.json`, `retires.json`, row-ID tagging, JUnit report).

- [ ] **Step 1: Commit the existing docs to `main` as the baseline, then branch**

```bash
cd agentic-workflow   # the repo root
git add AGENTS.md CLAUDE.md docs
git commit -m "docs: add workflow design and research"
git checkout -b feat/wf-core
```

- [ ] **Step 2: Amend the spec with the details this plan pins down**

Add this section to the design doc directly after `## Test staging, baseline and activation`:

```markdown
## Implementation conventions (pinned by the wf core plan)
- **Change folder:** `docs/changes/<id>/`, where `<id>` is kebab-case (`^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$`). There's no separate slug.
- **`change.json`** (covered by the spec gate): `{ "level": "P0"|"P1"|"P2"|"P3"|"P4", "noBehaviourChange": boolean }`.
- **Staging mirrors live paths.** `docs/changes/<id>/design/stage/<live path>` and `docs/changes/<id>/tests/stage/<live path>`. For example, `design/stage/packages/contracts/openapi.yaml` stages `packages/contracts/openapi.yaml`. Staging holds whole files, never diffs.
- **`wf promote <id> <design|tests>`** copies staging into live paths. Builders use it at the start of BUILD (replacing `wf test-staged`); the implementation PR's byte-identity check compares live files with staging.
- **`retires.json`** (covered by the tests gate): a JSON array of row IDs this change retires. Optional; absent means none.
- **Rows:** example tables are markdown tables whose first header cell is `ID` and which include an `Expected` column. Row IDs match `^[A-Z][A-Z0-9]{1,9}-\d{1,4}$`. Pipes inside cells aren't supported in v1.
- **Tests carry row tags:** each acceptance test name contains `[ROW-ID]`. The project's test command must write a JUnit XML report (`workflow.config.json → test.junitReport`).
- **trace-check scope:** every live row (in `docs/specs/**`) plus every row in the change's delta, minus rows in `retires.json`, must have an executed, passing test.
- **`workflow.config.json`:** `{ "approvers": ["<github-username>"], "test": { "setup": ["npm","ci"], "command": ["npx","vitest","run","--reporter=junit","--outputFile=reports/junit.xml"], "junitReport": "reports/junit.xml" } }`. `setup` is optional.
```

Also make these replacements in the same file:
- In the lifecycle block, stage 3: `draft into docs/changes/<id>/design/: OpenAPI diff,` → `draft into docs/changes/<id>/design/ (staged files under design/stage/ mirror live paths): contract,`
- In the lifecycle block, stage 5: `TDD against the staged tests (\`wf test-staged <id>\`);` → `TDD against the staged tests (\`wf promote <id> tests\` into their worktree);`
- In the layout block, the `design/` line → `design/ (design.md, mockups, adr drafts, stage/ mirroring live paths),` and the `tests/` line → `tests/stage/ (staged acceptance tests + harness, mirroring live paths), retires.json, change.json,`

- [ ] **Step 3: Commit**

```bash
git add docs/specs/2026-09-29-agentic-workflow-design.md
git commit -m "docs: pin staging, rows and config conventions"
```

---

### Task 1: Package scaffold, types and hashing

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`, `.gitignore`, `.github/workflows/ci.yml`
- Create: `src/types.ts`, `src/version.ts`, `src/guards.ts`, `src/hash.ts`
- Test: `test/hash.test.ts`

**Interfaces:**
- Produces:
  - `type Gate = 'spec' | 'design' | 'tests'`, `GATES`, `PREREQS: Record<Gate, readonly Gate[]>`, `type StageGate = 'design' | 'tests'`
  - `interface ApprovalRecord { change; gate; tool_version; requires: {gate, record_sha256}[]; covered: {path, sha256}[] }`
  - `type GateStatus = 'valid'|'missing'|'changed'|'stale'|'blocked'`, `interface GateResult { gate; status; problems: readonly string[] }`
  - `sha256(data: string | Uint8Array): string`, `sha256File(absPath: string): string`, `canonicalJson(value: unknown): string`
  - `isObject(v): v is Record<string, unknown>`, `isStringArray(v): v is string[]`
  - `TOOL_VERSION: string`

- [ ] **Step 1: Create the package files and install pinned dependencies**

`package.json`:
```json
{
  "name": "agentic-workflow",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": { "wf": "dist/bin.js" },
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "coverage": "vitest run --coverage"
  }
}
```

Run:
```bash
npm install --save-exact fast-xml-parser@5.11.2
npm install --save-dev --save-exact typescript@5.9.3 vitest@5.0.3 @vitest/coverage-v8@5.0.3 @types/node@24
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src", "test", "vitest.config.ts"]
}
```

`tsconfig.build.json`:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "noEmit": false, "rootDir": "src", "outDir": "dist" },
  "include": ["src"]
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/bin.ts'],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
```

`.gitignore`:
```
node_modules/
dist/
coverage/
```

`.github/workflows/ci.yml`:
```yaml
name: ci
on: [push, pull_request]
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm run coverage
```

- [ ] **Step 2: Write the failing test**

`test/hash.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalJson, sha256, sha256File } from '../src/hash.js';

describe('hash', () => {
  it('computes the standard sha256 of a string', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('hashes file bytes, so a CRLF change produces a different hash', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wf-hash-'));
    const lf = join(dir, 'lf.md');
    const crlf = join(dir, 'crlf.md');
    writeFileSync(lf, 'a\nb\n');
    writeFileSync(crlf, 'a\r\nb\r\n');
    expect(sha256File(lf)).toBe(sha256('a\nb\n'));
    expect(sha256File(lf)).not.toBe(sha256File(crlf));
  });

  it('writes canonical JSON with sorted keys at every depth and a trailing newline', () => {
    const json = canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: 2 } });
    expect(json).toBe(
      '{\n  "a": {\n    "c": 2,\n    "d": [\n      3,\n      {\n        "y": 2,\n        "z": 1\n      }\n    ]\n  },\n  "b": 1\n}\n',
    );
  });

  it('gives the same canonical JSON regardless of key insertion order', () => {
    expect(canonicalJson({ x: 1, y: 2 })).toBe(canonicalJson({ y: 2, x: 1 }));
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run test/hash.test.ts`
Expected: FAIL, `Failed to resolve import "../src/hash.js"`.

- [ ] **Step 4: Write the implementation**

`src/types.ts`:
```ts
export type Gate = 'spec' | 'design' | 'tests';
export const GATES: readonly Gate[] = ['spec', 'design', 'tests'];
export const PREREQS: Readonly<Record<Gate, readonly Gate[]>> = {
  spec: [],
  design: ['spec'],
  tests: ['spec', 'design'],
};

export type StageGate = 'design' | 'tests';
export const STAGE_GATES: readonly StageGate[] = ['design', 'tests'];

export interface CoveredFile {
  readonly path: string;
  readonly sha256: string;
}

export interface Requirement {
  readonly gate: Gate;
  readonly record_sha256: string;
}

export interface ApprovalRecord {
  readonly change: string;
  readonly gate: Gate;
  readonly tool_version: string;
  readonly requires: readonly Requirement[];
  readonly covered: readonly CoveredFile[];
}

export type GateStatus = 'valid' | 'missing' | 'changed' | 'stale' | 'blocked';

export interface GateResult {
  readonly gate: Gate;
  readonly status: GateStatus;
  readonly problems: readonly string[];
}

export interface Issue {
  readonly file: string;
  readonly line: number;
  readonly message: string;
}
```

`src/version.ts`:
```ts
export const TOOL_VERSION = '0.1.0';
```

`src/guards.ts`:
```ts
export const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string' && x !== '');
```

`src/hash.ts`:
```ts
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const sha256 = (data: string | Uint8Array): string =>
  createHash('sha256').update(data).digest('hex');

export const sha256File = (absPath: string): string => sha256(readFileSync(absPath));

const sortKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => [k, sortKeys(v)] as const);
    return Object.fromEntries(entries);
  }
  return value;
};

export const canonicalJson = (value: unknown): string =>
  `${JSON.stringify(sortKeys(value), null, 2)}\n`;
```

- [ ] **Step 5: Run the tests and the typecheck**

Run: `npx vitest run test/hash.test.ts && npm run typecheck`
Expected: 4 tests PASS; typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json tsconfig.build.json vitest.config.ts .gitignore .github/workflows/ci.yml src test
git commit -m "feat: scaffold wf package with hashing"
```

---

### Task 2: Safe paths, change IDs and symlink-free file listing

**Files:**
- Create: `src/paths.ts`, `test/helpers/repo.ts`
- Test: `test/paths.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `assertChangeId(id: string): string`
  - `assertSafeRepoPath(repoPath: string): string`
  - `fromRepoPath(root: string, repoPath: string): string` (absolute)
  - `toRepoPath(root: string, absPath: string): string` (posix, relative)
  - `changeDir(root: string, id: string): string`
  - `listFiles(absDir: string): string[]` (absolute, sorted; `[]` if the folder doesn't exist; throws on symlinks)
  - test helper `makeRepo(files?: Record<string,string>): { root; write(path, content): void; cleanup(): void }` and `git(root: string, ...args: string[]): string`

- [ ] **Step 1: Write the test helper**

`test/helpers/repo.ts`:
```ts
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export interface TestRepo {
  readonly root: string;
  write(path: string, content: string): void;
  cleanup(): void;
}

export function makeRepo(files: Record<string, string> = {}): TestRepo {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wf-test-')));
  const write = (path: string, content: string): void => {
    const abs = join(root, ...path.split('/'));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  };
  Object.entries(files).forEach(([p, c]) => write(p, c));
  return { root, write, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

export function git(root: string, ...args: string[]): string {
  const r = spawnSync(
    'git',
    ['-c', 'user.name=wf-test', '-c', 'user.email=wf-test@example.invalid', '-c', 'commit.gpgsign=false', ...args],
    { cwd: root, encoding: 'utf8' },
  );
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}
```

- [ ] **Step 2: Write the failing test**

`test/paths.test.ts`:
```ts
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import {
  assertChangeId, assertSafeRepoPath, changeDir, fromRepoPath, listFiles, toRepoPath,
} from '../src/paths.js';
import { makeRepo, type TestRepo } from './helpers/repo.js';

let repo: TestRepo;
afterEach(() => repo?.cleanup());

describe('assertChangeId', () => {
  it('accepts kebab-case ids', () => {
    expect(assertChangeId('listing-price-limits')).toBe('listing-price-limits');
  });
  it.each(['Bad', '../x', '', 'a', '-lead', 'trail-', 'x'.repeat(65), 'with space'])('rejects %j', (id) => {
    expect(() => assertChangeId(id)).toThrow(/Invalid change id/);
  });
});

describe('assertSafeRepoPath', () => {
  it('accepts a normal relative path', () => {
    expect(assertSafeRepoPath('docs/specs/a b.md')).toBe('docs/specs/a b.md');
  });
  it.each(['../etc/passwd', '/etc/passwd', 'a//b', 'a\\b', './a', 'a/./b', 'C:/x', ''])('rejects %j', (p) => {
    expect(() => assertSafeRepoPath(p)).toThrow(/Unsafe repository path/);
  });
});

describe('repo path conversion', () => {
  it('round-trips between repo paths and absolute paths', () => {
    repo = makeRepo();
    const abs = fromRepoPath(repo.root, 'docs/changes/x/spec-delta.md');
    expect(abs).toBe(join(repo.root, 'docs', 'changes', 'x', 'spec-delta.md'));
    expect(toRepoPath(repo.root, abs)).toBe('docs/changes/x/spec-delta.md');
  });
  it('refuses absolute paths outside the root', () => {
    repo = makeRepo();
    expect(() => toRepoPath(repo.root, join(repo.root, '..', 'elsewhere'))).toThrow(/outside the repository/);
  });
  it('builds the change folder path and validates the id', () => {
    repo = makeRepo();
    expect(changeDir(repo.root, 'abc')).toBe(join(repo.root, 'docs', 'changes', 'abc'));
    expect(() => changeDir(repo.root, '../abc')).toThrow(/Invalid change id/);
  });
});

describe('listFiles', () => {
  it('lists files recursively in sorted order and returns [] for a missing folder', () => {
    repo = makeRepo({ 'd/b.txt': 'b', 'd/a.txt': 'a', 'd/sub/c.txt': 'c' });
    expect(listFiles(join(repo.root, 'd')).map((f) => toRepoPath(repo.root, f))).toEqual([
      'd/a.txt', 'd/b.txt', 'd/sub/c.txt',
    ]);
    expect(listFiles(join(repo.root, 'missing'))).toEqual([]);
  });
  it('refuses a symlink inside the folder (Review Focus 1)', () => {
    repo = makeRepo({ 'd/a.txt': 'a' });
    symlinkSync('/etc/hosts', join(repo.root, 'd', 'link'));
    expect(() => listFiles(join(repo.root, 'd'))).toThrow(/Symlinks are not allowed/);
  });
  it('refuses when the folder itself is a symlink', () => {
    repo = makeRepo({ 'real/a.txt': 'a' });
    mkdirSync(join(repo.root, 'x'));
    symlinkSync(join(repo.root, 'real'), join(repo.root, 'x', 'linked'));
    expect(() => listFiles(join(repo.root, 'x', 'linked'))).toThrow(/Symlinks are not allowed/);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run test/paths.test.ts`
Expected: FAIL, `Failed to resolve import "../src/paths.js"`.

- [ ] **Step 4: Write the implementation**

`src/paths.ts`:
```ts
import { lstatSync, readdirSync, type Stats } from 'node:fs';
import { isAbsolute, join, posix, relative, sep } from 'node:path';

const CHANGE_ID = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/;

export function assertChangeId(id: string): string {
  if (!CHANGE_ID.test(id)) {
    throw new Error(`Invalid change id "${id}". Use lowercase letters, digits and dashes (2-64 chars).`);
  }
  return id;
}

export function assertSafeRepoPath(repoPath: string): string {
  const parts = repoPath.split('/');
  const unsafe =
    repoPath === '' ||
    repoPath.startsWith('/') ||
    repoPath.includes('\\') ||
    /^[A-Za-z]:/.test(repoPath) ||
    parts.some((p) => p === '' || p === '.' || p === '..');
  if (unsafe) throw new Error(`Unsafe repository path: "${repoPath}"`);
  return repoPath;
}

export const fromRepoPath = (root: string, repoPath: string): string =>
  join(root, ...assertSafeRepoPath(repoPath).split('/'));

export function toRepoPath(root: string, absPath: string): string {
  const rel = relative(root, absPath);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`Path is outside the repository: ${absPath}`);
  }
  return rel.split(sep).join(posix.sep);
}

export const changeDir = (root: string, id: string): string =>
  join(root, 'docs', 'changes', assertChangeId(id));

function lstatOrNull(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

export function listFiles(absDir: string): string[] {
  const stat = lstatOrNull(absDir);
  if (!stat) return [];
  if (stat.isSymbolicLink()) throw new Error(`Symlinks are not allowed in gated folders: ${absDir}`);
  if (!stat.isDirectory()) throw new Error(`Expected a folder: ${absDir}`);
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Symlinks are not allowed in gated folders: ${abs}`);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile()) found.push(abs);
    }
  };
  walk(absDir);
  return found.sort();
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/paths.test.ts && npm run typecheck`
Expected: all PASS; typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/paths.ts test/paths.test.ts test/helpers/repo.ts
git commit -m "feat: add safe repo paths and file listing"
```

---

### Task 3: Config and change metadata

**Files:**
- Create: `src/config.ts`, `src/change.ts`
- Test: `test/config.test.ts`

**Interfaces:**
- Consumes: `isObject`, `isStringArray` (Task 1); `assertSafeRepoPath`, `changeDir` (Task 2).
- Produces:
  - `interface WorkflowConfig { approvers: readonly string[]; test: { setup: readonly string[] | null; command: readonly string[]; junitReport: string } }`
  - `parseConfig(raw: unknown): WorkflowConfig`, `loadConfig(root: string): WorkflowConfig`
  - `type Level = 'P0'|'P1'|'P2'|'P3'|'P4'`, `interface ChangeMeta { level: Level; noBehaviourChange: boolean }`
  - `readChange(root: string, id: string): ChangeMeta`
  - `readRetires(root: string, id: string): ReadonlySet<string>`
  - `readJsonFile(absPath: string, label: string): unknown`
  - `ROW_ID: RegExp` (exported from `change.ts`)

- [ ] **Step 1: Write the failing test**

`test/config.test.ts`:
```ts
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig, parseConfig } from '../src/config.js';
import { readChange, readRetires } from '../src/change.js';
import { makeRepo, type TestRepo } from './helpers/repo.js';

let repo: TestRepo;
afterEach(() => repo?.cleanup());

const good = {
  approvers: ['tassi'],
  test: { command: ['npx', 'vitest', 'run'], junitReport: 'reports/junit.xml' },
};

describe('parseConfig', () => {
  it('accepts a valid config and defaults setup to null', () => {
    const c = parseConfig(good);
    expect(c.approvers).toEqual(['tassi']);
    expect(c.test.setup).toBeNull();
    expect(Object.isFrozen(c)).toBe(true);
  });
  it('accepts an optional setup command', () => {
    expect(parseConfig({ ...good, test: { ...good.test, setup: ['npm', 'ci'] } }).test.setup).toEqual(['npm', 'ci']);
  });
  it.each([
    ['not an object', []],
    ['empty approvers', { ...good, approvers: [] }],
    ['blank approver', { ...good, approvers: [' '] }],
    ['shell string command', { ...good, test: { ...good.test, command: 'npm test' } }],
    ['empty command', { ...good, test: { ...good.test, command: [] } }],
    ['unsafe report path', { ...good, test: { ...good.test, junitReport: '../x.xml' } }],
    ['missing test block', { approvers: ['tassi'] }],
  ])('rejects %s (Review Focus 2)', (_name, raw) => {
    expect(() => parseConfig(raw)).toThrow(/workflow\.config\.json/);
  });
});

describe('loadConfig', () => {
  it('names the file when JSON is truncated (Review Focus 2)', () => {
    repo = makeRepo({ 'workflow.config.json': '{"approvers": [' });
    expect(() => loadConfig(repo.root)).toThrow(/workflow\.config\.json/);
  });
  it('names the file when it is missing', () => {
    repo = makeRepo();
    expect(() => loadConfig(repo.root)).toThrow(/workflow\.config\.json/);
  });
});

describe('readChange and readRetires', () => {
  it('reads a valid change.json', () => {
    repo = makeRepo({ 'docs/changes/c1/change.json': '{"level":"P1","noBehaviourChange":false}' });
    expect(readChange(repo.root, 'c1')).toEqual({ level: 'P1', noBehaviourChange: false });
  });
  it.each([
    '{"level":"P9","noBehaviourChange":false}',
    '{"level":"P1"}',
    '{"level":"P1","noBehaviourChange":"no"}',
    'not json',
  ])('rejects a malformed change.json %j (Review Focus 2)', (body) => {
    repo = makeRepo({ 'docs/changes/c1/change.json': body });
    expect(() => readChange(repo.root, 'c1')).toThrow(/change\.json/);
  });
  it('returns an empty set when retires.json is absent', () => {
    repo = makeRepo();
    expect(readRetires(repo.root, 'c1').size).toBe(0);
  });
  it('reads retired row ids and rejects malformed ones', () => {
    repo = makeRepo({ 'docs/changes/c1/retires.json': '["LST-001","LST-002"]' });
    expect([...readRetires(repo.root, 'c1')]).toEqual(['LST-001', 'LST-002']);
    repo.write('docs/changes/c1/retires.json', '["lst-1"]');
    expect(() => readRetires(repo.root, 'c1')).toThrow(/retires\.json/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/config.test.ts`
Expected: FAIL, `Failed to resolve import "../src/config.js"`.

- [ ] **Step 3: Write the implementation**

`src/config.ts`:
```ts
import { join } from 'node:path';
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
  parseConfig(readJsonFile(join(root, 'workflow.config.json'), 'workflow.config.json'));
```

`src/change.ts`:
```ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isObject } from './guards.js';
import { changeDir } from './paths.js';

export const ROW_ID = /^[A-Z][A-Z0-9]{1,9}-\d{1,4}$/;
export type Level = 'P0' | 'P1' | 'P2' | 'P3' | 'P4';
const LEVELS: readonly string[] = ['P0', 'P1', 'P2', 'P3', 'P4'];

export interface ChangeMeta {
  readonly level: Level;
  readonly noBehaviourChange: boolean;
}

export function readJsonFile(absPath: string, label: string): unknown {
  let text: string;
  try {
    text = readFileSync(absPath, 'utf8');
  } catch (e) {
    throw new Error(`${label}: cannot read file (${(e as Error).message})`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`${label}: invalid JSON (${(e as Error).message})`);
  }
}

export function readChange(root: string, id: string): ChangeMeta {
  const label = `docs/changes/${id}/change.json`;
  const raw = readJsonFile(join(changeDir(root, id), 'change.json'), label);
  if (!isObject(raw) || typeof raw.level !== 'string' || !LEVELS.includes(raw.level)) {
    throw new Error(`${label}: "level" must be one of ${LEVELS.join(', ')}`);
  }
  if (typeof raw.noBehaviourChange !== 'boolean') {
    throw new Error(`${label}: "noBehaviourChange" must be true or false`);
  }
  return Object.freeze({ level: raw.level as Level, noBehaviourChange: raw.noBehaviourChange });
}

export function readRetires(root: string, id: string): ReadonlySet<string> {
  const path = join(changeDir(root, id), 'retires.json');
  if (!existsSync(path)) return new Set();
  const label = `docs/changes/${id}/retires.json`;
  const raw = readJsonFile(path, label);
  if (!Array.isArray(raw) || !raw.every((r) => typeof r === 'string' && ROW_ID.test(r))) {
    throw new Error(`${label}: must be a JSON array of row IDs like "LST-004"`);
  }
  return new Set(raw as string[]);
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/config.test.ts && npm run typecheck`
Expected: all PASS; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts src/change.ts test/config.test.ts
git commit -m "feat: load workflow config and change metadata"
```

---

### Task 4: Gate coverage

**Files:**
- Create: `src/coverage.ts`
- Test: `test/coverage.test.ts`

**Interfaces:**
- Consumes: `changeDir`, `listFiles`, `toRepoPath` (Task 2); `Gate` (Task 1).
- Produces: `coveredFiles(root: string, id: string, gate: Gate): string[]` (sorted repo paths); throws `Error` naming the missing required files.

Coverage rules (from spec + Task 0):
- `spec`: `proposal.md`, `spec-delta.md`, `change.json` (all required).
- `design`: every file under `design/` (`design/design.md` required).
- `tests`: every file under `tests/` + `baseline.json` (required) + `retires.json` (if present).

- [ ] **Step 1: Write the failing test**

`test/coverage.test.ts`:
```ts
import { afterEach, describe, expect, it } from 'vitest';
import { coveredFiles } from '../src/coverage.js';
import { makeRepo, type TestRepo } from './helpers/repo.js';

let repo: TestRepo;
afterEach(() => repo?.cleanup());
const C = 'docs/changes/c1';

describe('coveredFiles', () => {
  it('covers the spec files', () => {
    repo = makeRepo({ [`${C}/proposal.md`]: 'p', [`${C}/spec-delta.md`]: 's', [`${C}/change.json`]: '{}', [`${C}/tasks.md`]: 't' });
    expect(coveredFiles(repo.root, 'c1', 'spec')).toEqual([`${C}/change.json`, `${C}/proposal.md`, `${C}/spec-delta.md`]);
  });
  it('names missing spec files', () => {
    repo = makeRepo({ [`${C}/proposal.md`]: 'p' });
    expect(() => coveredFiles(repo.root, 'c1', 'spec')).toThrow(/missing: spec-delta\.md, change\.json/);
  });
  it('covers everything under design/, including staged files with spaces in names', () => {
    repo = makeRepo({
      [`${C}/design/design.md`]: 'd',
      [`${C}/design/mockups/list view.png`]: 'png',
      [`${C}/design/stage/packages/contracts/openapi.yaml`]: 'y',
    });
    expect(coveredFiles(repo.root, 'c1', 'design')).toEqual([
      `${C}/design/design.md`,
      `${C}/design/mockups/list view.png`,
      `${C}/design/stage/packages/contracts/openapi.yaml`,
    ]);
  });
  it('requires design.md', () => {
    repo = makeRepo({ [`${C}/design/stage/a.yaml`]: 'y' });
    expect(() => coveredFiles(repo.root, 'c1', 'design')).toThrow(/missing: design\/design\.md/);
  });
  it('covers staged tests, baseline.json and optional retires.json', () => {
    repo = makeRepo({ [`${C}/tests/stage/tests/acceptance/a.test.ts`]: 't', [`${C}/baseline.json`]: '{}' });
    expect(coveredFiles(repo.root, 'c1', 'tests')).toEqual([
      `${C}/baseline.json`,
      `${C}/tests/stage/tests/acceptance/a.test.ts`,
    ]);
    repo.write(`${C}/retires.json`, '[]');
    expect(coveredFiles(repo.root, 'c1', 'tests')).toContain(`${C}/retires.json`);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/coverage.test.ts`
Expected: FAIL, `Failed to resolve import "../src/coverage.js"`.

- [ ] **Step 3: Write the implementation**

`src/coverage.ts`:
```ts
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { changeDir, listFiles, toRepoPath } from './paths.js';
import type { Gate } from './types.js';

const REQUIRED: Readonly<Record<Gate, readonly string[]>> = {
  spec: ['proposal.md', 'spec-delta.md', 'change.json'],
  design: ['design/design.md'],
  tests: ['baseline.json'],
};
const OPTIONAL: Readonly<Record<Gate, readonly string[]>> = { spec: [], design: [], tests: ['retires.json'] };
const FOLDERS: Readonly<Record<Gate, readonly string[]>> = { spec: [], design: ['design'], tests: ['tests'] };

const abs = (dir: string, rel: string): string => join(dir, ...rel.split('/'));

export function coveredFiles(root: string, id: string, gate: Gate): string[] {
  const dir = changeDir(root, id);
  const missing = REQUIRED[gate].filter((f) => !existsSync(abs(dir, f)));
  if (missing.length > 0) throw new Error(`${gate} gate for ${id} is missing: ${missing.join(', ')}`);
  const named = [...REQUIRED[gate], ...OPTIONAL[gate].filter((f) => existsSync(abs(dir, f)))].map((f) => abs(dir, f));
  const inFolders = FOLDERS[gate].flatMap((f) => listFiles(abs(dir, f)));
  return [...new Set([...named, ...inFolders].map((a) => toRepoPath(root, a)))].sort();
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/coverage.test.ts && npm run typecheck`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/coverage.ts test/coverage.test.ts
git commit -m "feat: define files each gate covers"
```

---

### Task 5: Approval records

**Files:**
- Create: `src/record.ts`
- Test: `test/record.test.ts`

**Interfaces:**
- Consumes: `coveredFiles` (Task 4); `sha256File`, `canonicalJson` (Task 1); `readJsonFile` (Task 3); `changeDir`, `fromRepoPath`, `assertSafeRepoPath` (Task 2); `TOOL_VERSION`, `PREREQS`, `ApprovalRecord`, `Gate`.
- Produces:
  - `recordPath(root: string, id: string, gate: Gate): string`
  - `recordFileSha(root: string, id: string, gate: Gate): string | null` (sha256 of the record file's bytes)
  - `parseRecord(raw: unknown, id: string, gate: Gate): ApprovalRecord`
  - `readRecord(root: string, id: string, gate: Gate): ApprovalRecord | null` (throws on malformed)
  - `buildRecord(root: string, id: string, gate: Gate): ApprovalRecord`
  - `writeRecord(root: string, record: ApprovalRecord): string` (absolute path written)

- [ ] **Step 1: Write the failing test**

`test/record.test.ts`:
```ts
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { sha256, sha256File } from '../src/hash.js';
import { buildRecord, readRecord, recordFileSha, recordPath, writeRecord } from '../src/record.js';
import { makeRepo, type TestRepo } from './helpers/repo.js';

let repo: TestRepo;
afterEach(() => repo?.cleanup());
const C = 'docs/changes/c1';
const specFiles = { [`${C}/proposal.md`]: 'p', [`${C}/spec-delta.md`]: 's', [`${C}/change.json`]: '{"level":"P1","noBehaviourChange":false}' };

describe('approval records', () => {
  it('builds a spec record with hashes of covered files and no requirements', () => {
    repo = makeRepo(specFiles);
    const r = buildRecord(repo.root, 'c1', 'spec');
    expect(r.requires).toEqual([]);
    expect(r.covered).toEqual([
      { path: `${C}/change.json`, sha256: sha256(specFiles[`${C}/change.json`]) },
      { path: `${C}/proposal.md`, sha256: sha256('p') },
      { path: `${C}/spec-delta.md`, sha256: sha256('s') },
    ]);
  });

  it('writes canonical JSON, reads it back, and binds downstream records to the upstream file hash', () => {
    repo = makeRepo({ ...specFiles, [`${C}/design/design.md`]: 'd' });
    const path = writeRecord(repo.root, buildRecord(repo.root, 'c1', 'spec'));
    expect(path).toBe(recordPath(repo.root, 'c1', 'spec'));
    expect(readRecord(repo.root, 'c1', 'spec')?.gate).toBe('spec');
    expect(recordFileSha(repo.root, 'c1', 'spec')).toBe(sha256(readFileSync(path)));
    const design = buildRecord(repo.root, 'c1', 'design');
    expect(design.requires).toEqual([{ gate: 'spec', record_sha256: sha256File(path) }]);
  });

  it('refuses to build a downstream record before its upstream record exists', () => {
    repo = makeRepo({ ...specFiles, [`${C}/design/design.md`]: 'd' });
    expect(() => buildRecord(repo.root, 'c1', 'design')).toThrow(/spec has no approval record/);
  });

  it('returns null for a missing record', () => {
    repo = makeRepo();
    expect(readRecord(repo.root, 'c1', 'spec')).toBeNull();
    expect(recordFileSha(repo.root, 'c1', 'spec')).toBeNull();
  });

  it.each([
    ['truncated JSON', '{"change":'],
    ['wrong gate', '{"change":"c1","gate":"design","tool_version":"0.1.0","requires":[{"gate":"spec","record_sha256":"' + 'a'.repeat(64) + '"}],"covered":[]}'],
    ['wrong change', '{"change":"c2","gate":"spec","tool_version":"0.1.0","requires":[],"covered":[]}'],
    ['bad hash', '{"change":"c1","gate":"spec","tool_version":"0.1.0","requires":[],"covered":[{"path":"docs/a.md","sha256":"xyz"}]}'],
    ['unsafe covered path', '{"change":"c1","gate":"spec","tool_version":"0.1.0","requires":[],"covered":[{"path":"../a.md","sha256":"' + 'a'.repeat(64) + '"}]}'],
    ['missing requirement', '{"change":"c1","gate":"spec","tool_version":"0.1.0","requires":[{"gate":"spec","record_sha256":"' + 'a'.repeat(64) + '"}],"covered":[]}'],
  ])('rejects a malformed record: %s (Review Focus 2)', (_name, body) => {
    repo = makeRepo({ [`${C}/approvals/spec.json`]: body });
    expect(() => readRecord(repo.root, 'c1', 'spec')).toThrow(/approvals\/spec\.json/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/record.test.ts`
Expected: FAIL, `Failed to resolve import "../src/record.js"`.

- [ ] **Step 3: Write the implementation**

`src/record.ts`:
```ts
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readJsonFile } from './change.js';
import { coveredFiles } from './coverage.js';
import { isObject } from './guards.js';
import { canonicalJson, sha256File } from './hash.js';
import { assertSafeRepoPath, changeDir, fromRepoPath } from './paths.js';
import { PREREQS, type ApprovalRecord, type Gate } from './types.js';
import { TOOL_VERSION } from './version.js';

const HEX64 = /^[0-9a-f]{64}$/;

export const recordPath = (root: string, id: string, gate: Gate): string =>
  join(changeDir(root, id), 'approvals', `${gate}.json`);

export function recordFileSha(root: string, id: string, gate: Gate): string | null {
  const path = recordPath(root, id, gate);
  return existsSync(path) ? sha256File(path) : null;
}

export function parseRecord(raw: unknown, id: string, gate: Gate): ApprovalRecord {
  const label = `docs/changes/${id}/approvals/${gate}.json`;
  const bad = (msg: string): never => {
    throw new Error(`${label}: ${msg}`);
  };
  if (!isObject(raw)) return bad('must be a JSON object');
  if (raw.change !== id) bad(`"change" must be "${id}"`);
  if (raw.gate !== gate) bad(`"gate" must be "${gate}"`);
  if (typeof raw.tool_version !== 'string') bad('"tool_version" must be a string');
  const requires = Array.isArray(raw.requires) ? raw.requires : bad('"requires" must be a list');
  const expected = PREREQS[gate];
  const reqOk =
    requires.length === expected.length &&
    requires.every((r, i) => isObject(r) && r.gate === expected[i] && typeof r.record_sha256 === 'string' && HEX64.test(r.record_sha256));
  if (!reqOk) bad(`"requires" must list exactly [${expected.join(', ')}] with sha256 hashes`);
  const covered = Array.isArray(raw.covered) ? raw.covered : bad('"covered" must be a list');
  covered.forEach((c) => {
    if (!isObject(c) || typeof c.path !== 'string' || typeof c.sha256 !== 'string' || !HEX64.test(c.sha256)) {
      bad('every "covered" entry needs a path and a sha256 hash');
    }
    try {
      assertSafeRepoPath(c.path as string);
    } catch (e) {
      bad((e as Error).message);
    }
  });
  return Object.freeze(raw as unknown as ApprovalRecord);
}

export function readRecord(root: string, id: string, gate: Gate): ApprovalRecord | null {
  const path = recordPath(root, id, gate);
  if (!existsSync(path)) return null;
  return parseRecord(readJsonFile(path, `docs/changes/${id}/approvals/${gate}.json`), id, gate);
}

export function buildRecord(root: string, id: string, gate: Gate): ApprovalRecord {
  const requires = PREREQS[gate].map((up) => {
    const sha = recordFileSha(root, id, up);
    if (sha === null) throw new Error(`Cannot build the ${gate} record: ${up} has no approval record`);
    return { gate: up, record_sha256: sha };
  });
  const covered = coveredFiles(root, id, gate).map((p) => ({ path: p, sha256: sha256File(fromRepoPath(root, p)) }));
  return Object.freeze({ change: id, gate, tool_version: TOOL_VERSION, requires, covered });
}

export function writeRecord(root: string, record: ApprovalRecord): string {
  const path = recordPath(root, record.change, record.gate);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, canonicalJson(record));
  return path;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/record.test.ts && npm run typecheck`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/record.ts test/record.test.ts
git commit -m "feat: build and validate approval records"
```

---

### Task 6: Chained gate check

**Files:**
- Create: `src/gate-check.ts`
- Test: `test/gate-check.test.ts`

**Interfaces:**
- Consumes: `readRecord`, `recordFileSha` (Task 5); `coveredFiles` (Task 4); `sha256File`; `fromRepoPath`; `GATES`, `GateResult`, `Gate`.
- Produces: `checkGate(root: string, id: string, gate: Gate): GateResult` and `checkAll(root: string, id: string): GateResult[]`.

Status precedence: `missing` (no or unreadable record) → `changed` (own covered files differ, deleted, or added) → `blocked` (an upstream gate isn't valid) → `stale` (upstream record file hash differs from `requires`) → `valid`.

- [ ] **Step 1: Write the failing test**

`test/gate-check.test.ts`:
```ts
import { afterEach, describe, expect, it } from 'vitest';
import { rmSync } from 'node:fs';
import { buildRecord, writeRecord } from '../src/record.js';
import { checkAll, checkGate } from '../src/gate-check.js';
import type { Gate } from '../src/types.js';
import { makeRepo, type TestRepo } from './helpers/repo.js';

let repo: TestRepo;
afterEach(() => repo?.cleanup());
const C = 'docs/changes/c1';
const files = {
  [`${C}/proposal.md`]: 'p',
  [`${C}/spec-delta.md`]: 's',
  [`${C}/change.json`]: '{"level":"P1","noBehaviourChange":false}',
  [`${C}/design/design.md`]: 'd',
  [`${C}/tests/stage/tests/acceptance/a.test.ts`]: 't',
  [`${C}/baseline.json`]: '{}',
};
const approveRaw = (g: Gate): void => {
  writeRecord(repo.root, buildRecord(repo.root, 'c1', g));
};
const statuses = (): string[] => checkAll(repo.root, 'c1').map((r) => `${r.gate}:${r.status}`);

describe('checkGate', () => {
  it('reports missing records', () => {
    repo = makeRepo(files);
    expect(statuses()).toEqual(['spec:missing', 'design:missing', 'tests:missing']);
  });

  it('reports all valid after approving in order', () => {
    repo = makeRepo(files);
    approveRaw('spec'); approveRaw('design'); approveRaw('tests');
    expect(statuses()).toEqual(['spec:valid', 'design:valid', 'tests:valid']);
  });

  it('marks an edited spec changed and downstream gates blocked', () => {
    repo = makeRepo(files);
    approveRaw('spec'); approveRaw('design'); approveRaw('tests');
    repo.write(`${C}/spec-delta.md`, 's2');
    expect(statuses()).toEqual(['spec:changed', 'design:blocked', 'tests:blocked']);
    expect(checkGate(repo.root, 'c1', 'spec').problems).toContain(`${C}/spec-delta.md changed`);
  });

  it('marks downstream gates stale after the spec is re-approved (chained binding)', () => {
    repo = makeRepo(files);
    approveRaw('spec'); approveRaw('design'); approveRaw('tests');
    repo.write(`${C}/spec-delta.md`, 's2');
    approveRaw('spec');
    expect(statuses()).toEqual(['spec:valid', 'design:stale', 'tests:blocked']);
    approveRaw('design');
    expect(statuses()).toEqual(['spec:valid', 'design:valid', 'tests:stale']);
    approveRaw('tests');
    expect(statuses()).toEqual(['spec:valid', 'design:valid', 'tests:valid']);
  });

  it('marks a gate changed when a file is added to its folder after approval (Review Focus 5)', () => {
    repo = makeRepo(files);
    approveRaw('spec'); approveRaw('design');
    repo.write(`${C}/design/mockups/new.png`, 'x');
    const r = checkGate(repo.root, 'c1', 'design');
    expect(r.status).toBe('changed');
    expect(r.problems).toContain(`${C}/design/mockups/new.png was added after approval`);
  });

  it('marks a gate changed when a covered file is deleted', () => {
    repo = makeRepo({ ...files, [`${C}/design/extra.md`]: 'e' });
    approveRaw('spec'); approveRaw('design');
    rmSync(`${repo.root}/${C}/design/extra.md`);
    expect(checkGate(repo.root, 'c1', 'design').problems).toContain(`${C}/design/extra.md was deleted`);
  });

  it('treats an unreadable record as missing, never valid (Review Focus 2)', () => {
    repo = makeRepo({ ...files, [`${C}/approvals/spec.json`]: '{oops' });
    const r = checkGate(repo.root, 'c1', 'spec');
    expect(r.status).toBe('missing');
    expect(r.problems[0]).toMatch(/approvals\/spec\.json/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/gate-check.test.ts`
Expected: FAIL, `Failed to resolve import "../src/gate-check.js"`.

- [ ] **Step 3: Write the implementation**

`src/gate-check.ts`:
```ts
import { existsSync } from 'node:fs';
import { coveredFiles } from './coverage.js';
import { sha256File } from './hash.js';
import { fromRepoPath } from './paths.js';
import { readRecord, recordFileSha } from './record.js';
import { GATES, type ApprovalRecord, type Gate, type GateResult } from './types.js';

const result = (gate: Gate, status: GateResult['status'], problems: readonly string[]): GateResult =>
  Object.freeze({ gate, status, problems: Object.freeze([...new Set(problems)]) });

function ownChanges(root: string, id: string, gate: Gate, record: ApprovalRecord): string[] {
  const fromRecord = record.covered.flatMap((c) => {
    const abs = fromRepoPath(root, c.path);
    if (!existsSync(abs)) return [`${c.path} was deleted`];
    return sha256File(abs) === c.sha256 ? [] : [`${c.path} changed`];
  });
  let current: string[];
  try {
    current = coveredFiles(root, id, gate);
  } catch (e) {
    return [...fromRecord, (e as Error).message];
  }
  const approved = new Set(record.covered.map((c) => c.path));
  const added = current.filter((p) => !approved.has(p)).map((p) => `${p} was added after approval`);
  return [...fromRecord, ...added];
}

export function checkGate(root: string, id: string, gate: Gate): GateResult {
  let record: ApprovalRecord | null;
  try {
    record = readRecord(root, id, gate);
  } catch (e) {
    return result(gate, 'missing', [(e as Error).message]);
  }
  if (record === null) return result(gate, 'missing', [`No approval record for the ${gate} gate`]);
  const changed = ownChanges(root, id, gate, record);
  if (changed.length > 0) return result(gate, 'changed', changed);
  for (const req of record.requires) {
    const upstream = checkGate(root, id, req.gate);
    if (upstream.status !== 'valid') return result(gate, 'blocked', [`the ${req.gate} gate is ${upstream.status}`]);
  }
  const stale = record.requires
    .filter((req) => recordFileSha(root, id, req.gate) !== req.record_sha256)
    .map((req) => `approved against an older ${req.gate} record; re-approve ${gate}`);
  return stale.length > 0 ? result(gate, 'stale', stale) : result(gate, 'valid', []);
}

export const checkAll = (root: string, id: string): GateResult[] => GATES.map((g) => checkGate(root, id, g));
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/gate-check.test.ts && npm run typecheck`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/gate-check.ts test/gate-check.test.ts
git commit -m "feat: add chained gate check"
```

---

### Task 7: Approve command logic

**Files:**
- Create: `src/approve.ts`
- Test: `test/approve.test.ts`

**Interfaces:**
- Consumes: `checkGate` (Task 6); `buildRecord`, `writeRecord` (Task 5); `PREREQS`.
- Produces: `approve(root: string, id: string, gate: Gate): { record: ApprovalRecord; path: string }`. Throws if any upstream gate isn't `valid`, naming the gate and its status.

- [ ] **Step 1: Write the failing test**

`test/approve.test.ts`:
```ts
import { afterEach, describe, expect, it } from 'vitest';
import { approve } from '../src/approve.js';
import { checkGate } from '../src/gate-check.js';
import { makeRepo, type TestRepo } from './helpers/repo.js';

let repo: TestRepo;
afterEach(() => repo?.cleanup());
const C = 'docs/changes/c1';
const files = {
  [`${C}/proposal.md`]: 'p',
  [`${C}/spec-delta.md`]: 's',
  [`${C}/change.json`]: '{"level":"P1","noBehaviourChange":false}',
  [`${C}/design/design.md`]: 'd',
};

describe('approve', () => {
  it('approves the spec gate and writes the record', () => {
    repo = makeRepo(files);
    const { path } = approve(repo.root, 'c1', 'spec');
    expect(path).toMatch(/approvals\/spec\.json$/);
    expect(checkGate(repo.root, 'c1', 'spec').status).toBe('valid');
  });

  it('refuses to approve design while spec is missing', () => {
    repo = makeRepo(files);
    expect(() => approve(repo.root, 'c1', 'design')).toThrow(/Cannot approve design: the spec gate is missing/);
  });

  it('refuses to approve design while spec has changed since approval', () => {
    repo = makeRepo(files);
    approve(repo.root, 'c1', 'spec');
    repo.write(`${C}/proposal.md`, 'p2');
    expect(() => approve(repo.root, 'c1', 'design')).toThrow(/the spec gate is changed/);
  });

  it('re-approving a stale downstream gate makes it valid', () => {
    repo = makeRepo(files);
    approve(repo.root, 'c1', 'spec');
    approve(repo.root, 'c1', 'design');
    repo.write(`${C}/spec-delta.md`, 's2');
    approve(repo.root, 'c1', 'spec');
    expect(checkGate(repo.root, 'c1', 'design').status).toBe('stale');
    approve(repo.root, 'c1', 'design');
    expect(checkGate(repo.root, 'c1', 'design').status).toBe('valid');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/approve.test.ts`
Expected: FAIL, `Failed to resolve import "../src/approve.js"`.

- [ ] **Step 3: Write the implementation**

`src/approve.ts`:
```ts
import { checkGate } from './gate-check.js';
import { buildRecord, writeRecord } from './record.js';
import { PREREQS, type ApprovalRecord, type Gate } from './types.js';

export function approve(root: string, id: string, gate: Gate): { record: ApprovalRecord; path: string } {
  for (const up of PREREQS[gate]) {
    const r = checkGate(root, id, up);
    if (r.status !== 'valid') {
      throw new Error(`Cannot approve ${gate}: the ${up} gate is ${r.status} (${r.problems.join('; ')}). Approve ${up} first.`);
    }
  }
  const record = buildRecord(root, id, gate);
  return { record, path: writeRecord(root, record) };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/approve.test.ts && npm run typecheck`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/approve.ts test/approve.test.ts
git commit -m "feat: approve gates only on valid upstream"
```

---

### Task 8: Staging, byte-identity and promote

**Files:**
- Create: `src/stage.ts`
- Test: `test/stage.test.ts`

**Interfaces:**
- Consumes: `changeDir`, `listFiles`, `toRepoPath`, `fromRepoPath` (Task 2); `sha256File`; `StageGate`.
- Produces:
  - `interface StagedFile { stagePath: string; livePath: string }` (both repo paths)
  - `stagedFiles(root: string, id: string, gate: StageGate): StagedFile[]`
  - `interface StageMismatch { livePath: string; reason: 'missing' | 'different' }`
  - `checkStage(root: string, id: string, gate: StageGate): StageMismatch[]`
  - `promote(root: string, id: string, gate: StageGate): string[]` (live repo paths written)

- [ ] **Step 1: Write the failing test**

`test/stage.test.ts`:
```ts
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { checkStage, promote, stagedFiles } from '../src/stage.js';
import { makeRepo, type TestRepo } from './helpers/repo.js';

let repo: TestRepo;
afterEach(() => repo?.cleanup());
const C = 'docs/changes/c1';

describe('staging', () => {
  it('maps staged files to the live paths they mirror', () => {
    repo = makeRepo({ [`${C}/tests/stage/tests/acceptance/price.test.ts`]: 't' });
    expect(stagedFiles(repo.root, 'c1', 'tests')).toEqual([
      { stagePath: `${C}/tests/stage/tests/acceptance/price.test.ts`, livePath: 'tests/acceptance/price.test.ts' },
    ]);
  });

  it('promotes staged files into live paths and then reports no mismatch', () => {
    repo = makeRepo({ [`${C}/design/stage/packages/contracts/openapi.yaml`]: 'openapi: 3.1.0\n' });
    expect(checkStage(repo.root, 'c1', 'design')).toEqual([{ livePath: 'packages/contracts/openapi.yaml', reason: 'missing' }]);
    expect(promote(repo.root, 'c1', 'design')).toEqual(['packages/contracts/openapi.yaml']);
    expect(readFileSync(join(repo.root, 'packages/contracts/openapi.yaml'), 'utf8')).toBe('openapi: 3.1.0\n');
    expect(checkStage(repo.root, 'c1', 'design')).toEqual([]);
  });

  it('reports a live file that differs from the approved staging', () => {
    repo = makeRepo({ [`${C}/tests/stage/tests/acceptance/a.test.ts`]: 'expect(422)' });
    promote(repo.root, 'c1', 'tests');
    repo.write('tests/acceptance/a.test.ts', 'expect(200)');
    expect(checkStage(repo.root, 'c1', 'tests')).toEqual([{ livePath: 'tests/acceptance/a.test.ts', reason: 'different' }]);
  });

  it.each(['docs/changes/other/x.md', '.git/config', '.github/workflows/ci.yml', '.workflow/version'])(
    'refuses staged files that target %s',
    (target) => {
      repo = makeRepo({ [`${C}/tests/stage/${target}`]: 'x' });
      expect(() => stagedFiles(repo.root, 'c1', 'tests')).toThrow(/may not target/);
    },
  );

  it('refuses a symlink in staging and copies nothing (Review Focus 1)', () => {
    repo = makeRepo({ [`${C}/tests/stage/tests/a.test.ts`]: 't' });
    symlinkSync('/etc/hosts', join(repo.root, C, 'tests', 'stage', 'tests', 'hosts'));
    expect(() => promote(repo.root, 'c1', 'tests')).toThrow(/Symlinks are not allowed/);
    expect(() => readFileSync(join(repo.root, 'tests', 'a.test.ts'))).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/stage.test.ts`
Expected: FAIL, `Failed to resolve import "../src/stage.js"`.

- [ ] **Step 3: Write the implementation**

`src/stage.ts`:
```ts
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { sha256File } from './hash.js';
import { changeDir, fromRepoPath, listFiles, toRepoPath } from './paths.js';
import type { StageGate } from './types.js';

export interface StagedFile {
  readonly stagePath: string;
  readonly livePath: string;
}

export interface StageMismatch {
  readonly livePath: string;
  readonly reason: 'missing' | 'different';
}

const FORBIDDEN = ['docs/changes/', '.git/', '.github/', '.workflow/'];

const stageRoot = (root: string, id: string, gate: StageGate): string => join(changeDir(root, id), gate, 'stage');

export function stagedFiles(root: string, id: string, gate: StageGate): StagedFile[] {
  const base = stageRoot(root, id, gate);
  return listFiles(base).map((abs) => {
    const livePath = toRepoPath(base, abs);
    if (FORBIDDEN.some((f) => livePath.startsWith(f))) {
      throw new Error(`Staged file ${toRepoPath(root, abs)} may not target ${livePath}`);
    }
    return Object.freeze({ stagePath: toRepoPath(root, abs), livePath });
  });
}

export function checkStage(root: string, id: string, gate: StageGate): StageMismatch[] {
  return stagedFiles(root, id, gate).flatMap((f): StageMismatch[] => {
    const live = fromRepoPath(root, f.livePath);
    if (!existsSync(live)) return [{ livePath: f.livePath, reason: 'missing' }];
    return sha256File(live) === sha256File(fromRepoPath(root, f.stagePath)) ? [] : [{ livePath: f.livePath, reason: 'different' }];
  });
}

export function promote(root: string, id: string, gate: StageGate): string[] {
  const files = stagedFiles(root, id, gate);
  files.forEach((f) => {
    const live = fromRepoPath(root, f.livePath);
    mkdirSync(dirname(live), { recursive: true });
    copyFileSync(fromRepoPath(root, f.stagePath), live);
  });
  return files.map((f) => f.livePath);
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/stage.test.ts && npm run typecheck`
Expected: all PASS. (`stagedFiles` lists everything before `promote` copies anything, so a symlink anywhere aborts the whole promote.)

- [ ] **Step 5: Commit**

```bash
git add src/stage.ts test/stage.test.ts
git commit -m "feat: add staging, promote and byte-identity"
```

---

### Task 9: Row parsing, spec index and spec-lint

**Files:**
- Create: `src/rows.ts`, `src/spec-index.ts`, `src/spec-lint.ts`
- Test: `test/rows.test.ts`, `test/spec-lint.test.ts`

**Interfaces:**
- Consumes: `ROW_ID` (Task 3); `changeDir`, `listFiles`, `toRepoPath` (Task 2); `Issue` (Task 1).
- Produces:
  - `interface SpecRow { id: string; cells: Readonly<Record<string,string>>; file: string; line: number }`
  - `parseRows(markdown: string, file: string): SpecRow[]` (tables whose first header is `ID`; ignores fenced code)
  - `openChangeIds(root: string): string[]` (folders in `docs/changes`, excluding `archive`)
  - `changeRows(root: string, id: string): SpecRow[]` and `changeRowIds(root: string, id: string): string[]` (valid, unique, sorted)
  - `liveRowIds(root: string): ReadonlySet<string>` (from `docs/specs/**/*.md`)
  - `lintChange(root: string, id: string): Issue[]`

- [ ] **Step 1: Write the failing tests**

`test/rows.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { parseRows } from '../src/rows.js';

const md = [
  '# Listing price',
  '',
  '| ID | Price | Expected |',
  '|----|------:|----------|',
  '| LST-001 | 0 | 422 |',
  '| LST-002 | 999999 | 201 |',
  '',
  '```md',
  '| ID | ignored | Expected |',
  '|---|---|---|',
  '| LST-999 | x | y |',
  '```',
  '',
  '| Name | Value |',
  '|---|---|',
  '| a | b |',
].join('\n');

describe('parseRows', () => {
  it('parses ID tables with cells keyed by header and 1-based line numbers', () => {
    const rows = parseRows(md, 'docs/specs/listing/spec.md');
    expect(rows.map((r) => r.id)).toEqual(['LST-001', 'LST-002']);
    expect(rows[0]).toEqual({
      id: 'LST-001',
      cells: { ID: 'LST-001', Price: '0', Expected: '422' },
      file: 'docs/specs/listing/spec.md',
      line: 5,
    });
  });
  it('handles CRLF line endings', () => {
    expect(parseRows(md.replaceAll('\n', '\r\n'), 'f.md').map((r) => r.id)).toEqual(['LST-001', 'LST-002']);
  });
  it('ignores a header without a separator row', () => {
    expect(parseRows('| ID | Expected |\n| LST-001 | x |', 'f.md')).toEqual([]);
  });
});
```

`test/spec-lint.test.ts`:
```ts
import { afterEach, describe, expect, it } from 'vitest';
import { changeRowIds, liveRowIds, openChangeIds } from '../src/spec-index.js';
import { lintChange } from '../src/spec-lint.js';
import { makeRepo, type TestRepo } from './helpers/repo.js';

let repo: TestRepo;
afterEach(() => repo?.cleanup());
const table = (rows: string[]): string => ['| ID | Price | Expected |', '|---|---|---|', ...rows].join('\n');

describe('spec index', () => {
  it('collects live rows, change rows and open changes (excluding archive)', () => {
    repo = makeRepo({
      'docs/specs/listing/spec.md': table(['| LST-001 | 1 | 201 |']),
      'docs/changes/c1/spec-delta.md': table(['| LST-002 | 0 | 422 |', '| LST-002 | 0 | 422 |', '| bad | 1 | x |']),
      'docs/changes/archive/old/spec-delta.md': table(['| LST-003 | 1 | 1 |']),
    });
    expect([...liveRowIds(repo.root)]).toEqual(['LST-001']);
    expect(changeRowIds(repo.root, 'c1')).toEqual(['LST-002']);
    expect(openChangeIds(repo.root)).toEqual(['c1']);
  });
});

describe('lintChange', () => {
  it('passes a clean delta', () => {
    repo = makeRepo({ 'docs/changes/c1/spec-delta.md': table(['| LST-001 | 0 | 422 |', '| LST-002 | 1 | 201 |']) });
    expect(lintChange(repo.root, 'c1')).toEqual([]);
  });
  it('reports malformed ids, duplicates and conflicting rows', () => {
    repo = makeRepo({
      'docs/changes/c1/spec-delta.md': table(['| lst-1 | 0 | 422 |', '| LST-002 | 5 | 201 |', '| LST-002 | 6 | 201 |', '| LST-003 | 5 | 422 |']),
    });
    const messages = lintChange(repo.root, 'c1').map((i) => i.message);
    expect(messages).toContain('Row ID "lst-1" must look like LST-004');
    expect(messages).toContain('Row ID LST-002 appears more than once');
    expect(messages).toContain('LST-003 has the same inputs as LST-002 but a different Expected value');
  });
  it('reports a table without an Expected column', () => {
    repo = makeRepo({ 'docs/changes/c1/spec-delta.md': '| ID | Price |\n|---|---|\n| LST-001 | 0 |' });
    expect(lintChange(repo.root, 'c1').map((i) => i.message)).toContain('Row LST-001 is in a table without an Expected column');
  });
  it('reports a new row id that another open change also introduces, but allows modifying a live row', () => {
    repo = makeRepo({
      'docs/specs/listing/spec.md': table(['| LST-001 | 1 | 201 |']),
      'docs/changes/c1/spec-delta.md': table(['| LST-001 | 1 | 202 |', '| LST-005 | 0 | 422 |']),
      'docs/changes/c2/spec-delta.md': table(['| LST-005 | 9 | 201 |']),
    });
    expect(lintChange(repo.root, 'c1').map((i) => i.message)).toEqual(['New row LST-005 is also introduced by open change c2']);
  });
  it('reports a missing spec-delta.md', () => {
    repo = makeRepo();
    expect(lintChange(repo.root, 'c1').map((i) => i.message)).toEqual(['spec-delta.md is missing']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/rows.test.ts test/spec-lint.test.ts`
Expected: FAIL, unresolved imports.

- [ ] **Step 3: Write the implementation**

`src/rows.ts`:
```ts
export interface SpecRow {
  readonly id: string;
  readonly cells: Readonly<Record<string, string>>;
  readonly file: string;
  readonly line: number;
}

const splitRow = (line: string): string[] | null => {
  const t = line.trim();
  if (t.length < 2 || !t.startsWith('|') || !t.endsWith('|')) return null;
  return t.slice(1, -1).split('|').map((c) => c.trim());
};

const isSeparator = (cells: string[] | null): boolean =>
  cells !== null && cells.length > 0 && cells.every((c) => /^:?-{3,}:?$/.test(c));

export function parseRows(markdown: string, file: string): SpecRow[] {
  const lines = markdown.split(/\r?\n/);
  const rows: SpecRow[] = [];
  let header: string[] | null = null;
  let inFence = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (line.trim().startsWith('```')) {
      inFence = !inFence;
      header = null;
      continue;
    }
    const cells = inFence ? null : splitRow(line);
    if (cells === null) {
      header = null;
      continue;
    }
    if (header === null) {
      if ((cells[0] ?? '').toLowerCase() === 'id' && isSeparator(splitRow(lines[i + 1] ?? ''))) {
        header = cells;
        i += 1;
      }
      continue;
    }
    const keys = header;
    rows.push(Object.freeze({
      id: cells[0] ?? '',
      cells: Object.freeze(Object.fromEntries(keys.map((h, k) => [h, cells[k] ?? '']))),
      file,
      line: i + 1,
    }));
  }
  return rows;
}
```

`src/spec-index.ts`:
```ts
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROW_ID } from './change.js';
import { changeDir, listFiles, toRepoPath } from './paths.js';
import { parseRows, type SpecRow } from './rows.js';

export function openChangeIds(root: string): string[] {
  const dir = join(root, 'docs', 'changes');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== 'archive')
    .map((e) => e.name)
    .sort();
}

export function changeRows(root: string, id: string): SpecRow[] {
  const path = join(changeDir(root, id), 'spec-delta.md');
  if (!existsSync(path)) return [];
  return parseRows(readFileSync(path, 'utf8'), toRepoPath(root, path));
}

export const changeRowIds = (root: string, id: string): string[] =>
  [...new Set(changeRows(root, id).map((r) => r.id).filter((r) => ROW_ID.test(r)))].sort();

export function liveRowIds(root: string): ReadonlySet<string> {
  const files = listFiles(join(root, 'docs', 'specs')).filter((f) => f.endsWith('.md'));
  const ids = files.flatMap((f) => parseRows(readFileSync(f, 'utf8'), toRepoPath(root, f)).map((r) => r.id));
  return new Set(ids.filter((r) => ROW_ID.test(r)).sort());
}
```

`src/spec-lint.ts`:
```ts
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROW_ID } from './change.js';
import { changeDir } from './paths.js';
import type { SpecRow } from './rows.js';
import { changeRowIds, changeRows, liveRowIds, openChangeIds } from './spec-index.js';
import type { Issue } from './types.js';

const issue = (row: SpecRow, message: string): Issue => ({ file: row.file, line: row.line, message });
const expectedKey = (row: SpecRow): string | undefined =>
  Object.keys(row.cells).find((k) => k.toLowerCase() === 'expected');

function rowIssues(rows: readonly SpecRow[]): Issue[] {
  const seen = new Map<string, SpecRow>();
  const byInputs = new Map<string, SpecRow>();
  return rows.flatMap((row) => {
    const found: Issue[] = [];
    if (!ROW_ID.test(row.id)) found.push(issue(row, `Row ID "${row.id}" must look like LST-004`));
    if (seen.has(row.id)) found.push(issue(row, `Row ID ${row.id} appears more than once`));
    seen.set(row.id, row);
    const exp = expectedKey(row);
    if (exp === undefined) return [...found, issue(row, `Row ${row.id} is in a table without an Expected column`)];
    const inputs = JSON.stringify(Object.entries(row.cells).filter(([k]) => k.toLowerCase() !== 'id' && k !== exp));
    const twin = byInputs.get(inputs);
    if (twin && twin.cells[exp] !== row.cells[exp]) {
      found.push(issue(row, `${row.id} has the same inputs as ${twin.id} but a different Expected value`));
    }
    if (!twin) byInputs.set(inputs, row);
    return found;
  });
}

function collisionIssues(root: string, id: string, rows: readonly SpecRow[]): Issue[] {
  const live = liveRowIds(root);
  const others = openChangeIds(root).filter((c) => c !== id);
  return rows
    .filter((r) => ROW_ID.test(r.id) && !live.has(r.id))
    .flatMap((r) => others.filter((c) => changeRowIds(root, c).includes(r.id)).map((c) => issue(r, `New row ${r.id} is also introduced by open change ${c}`)));
}

export function lintChange(root: string, id: string): Issue[] {
  const path = join(changeDir(root, id), 'spec-delta.md');
  if (!existsSync(path)) return [{ file: `docs/changes/${id}/spec-delta.md`, line: 0, message: 'spec-delta.md is missing' }];
  const rows = changeRows(root, id);
  return [...rowIssues(rows), ...collisionIssues(root, id, rows)];
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/rows.test.ts test/spec-lint.test.ts && npm run typecheck`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/rows.ts src/spec-index.ts src/spec-lint.ts test/rows.test.ts test/spec-lint.test.ts
git commit -m "feat: parse example tables and lint spec deltas"
```

---

### Task 10: JUnit parsing

**Files:**
- Create: `src/junit.ts`
- Test: `test/junit.test.ts`

**Interfaces:**
- Consumes: `isObject` (Task 1).
- Produces:
  - `interface TestCase { name: string; classname: string; status: 'passed'|'failed'|'skipped'; rowIds: readonly string[] }`
  - `parseJUnit(xml: string): TestCase[]` (throws `Invalid JUnit XML…` or `…no <testsuite> elements`)

- [ ] **Step 1: Write the failing test**

`test/junit.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { parseJUnit } from '../src/junit.js';

describe('parseJUnit (Review Focus 4)', () => {
  it('parses nested suites with passed, failed, errored and skipped cases', () => {
    const xml = `<?xml version="1.0"?>
<testsuites>
  <testsuite name="outer">
    <testsuite name="inner">
      <testcase classname="price" name="[LST-001] rejects price 0"/>
      <testcase classname="price" name="[LST-002] rejects over limit"><failure message="x"/></testcase>
    </testsuite>
    <testcase classname="dup" name="[LST-003] duplicate submit"><error message="boom"/></testcase>
    <testcase classname="dup" name="[LST-004] skipped one"><skipped/></testcase>
  </testsuite>
</testsuites>`;
    expect(parseJUnit(xml).map((c) => `${c.rowIds.join('+')}:${c.status}`)).toEqual([
      'LST-001:passed', 'LST-002:failed', 'LST-003:failed', 'LST-004:skipped',
    ]);
  });

  it('accepts a single <testsuite> root and multiple row tags on one test', () => {
    const xml = '<testsuite name="s"><testcase classname="c" name="[LST-001][LST-002] shared setup"></testcase></testsuite>';
    expect(parseJUnit(xml)).toEqual([{ name: '[LST-001][LST-002] shared setup', classname: 'c', status: 'passed', rowIds: ['LST-001', 'LST-002'] }]);
  });

  it('picks up a row tag that appears only in the classname', () => {
    const xml = '<testsuite name="s"><testcase classname="[LST-007] price limits" name="rejects 0"/></testsuite>';
    expect(parseJUnit(xml)[0]?.rowIds).toEqual(['LST-007']);
  });

  it('returns an empty list for a suite with no tests', () => {
    expect(parseJUnit('<testsuites><testsuite name="empty" tests="0"></testsuite></testsuites>')).toEqual([]);
  });

  it('rejects invalid XML and documents without suites', () => {
    expect(() => parseJUnit('<testsuite><testcase>')).toThrow(/Invalid JUnit XML/);
    expect(() => parseJUnit('<report/>')).toThrow(/no <testsuite> elements/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/junit.test.ts`
Expected: FAIL, `Failed to resolve import "../src/junit.js"`.

- [ ] **Step 3: Write the implementation**

`src/junit.ts`:
```ts
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { isObject } from './guards.js';

export interface TestCase {
  readonly name: string;
  readonly classname: string;
  readonly status: 'passed' | 'failed' | 'skipped';
  readonly rowIds: readonly string[];
}

const TAG = /\[([A-Z][A-Z0-9]{1,9}-\d{1,4})\]/g;
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) => name === 'testsuite' || name === 'testcase' || name === 'testsuites',
});

const tags = (text: string): string[] => [...text.matchAll(TAG)].map((m) => m[1] ?? '');

function toCase(node: unknown): TestCase {
  const tc = isObject(node) ? node : {};
  const name = String(tc['@_name'] ?? '');
  const classname = String(tc['@_classname'] ?? '');
  const status = 'failure' in tc || 'error' in tc ? 'failed' : 'skipped' in tc ? 'skipped' : 'passed';
  return Object.freeze({ name, classname, status, rowIds: Object.freeze([...new Set([...tags(name), ...tags(classname)])]) });
}

function collect(node: unknown): TestCase[] {
  if (!isObject(node)) return [];
  const cases = Array.isArray(node.testcase) ? node.testcase.map(toCase) : [];
  const nested = ['testsuites', 'testsuite'].flatMap((k) => (Array.isArray(node[k]) ? (node[k] as unknown[]).flatMap(collect) : []));
  return [...nested, ...cases];
}

export function parseJUnit(xml: string): TestCase[] {
  const valid = XMLValidator.validate(xml);
  if (valid !== true) throw new Error(`Invalid JUnit XML: ${valid.err.msg} (line ${valid.err.line})`);
  const doc: unknown = parser.parse(xml);
  if (!isObject(doc) || !('testsuites' in doc || 'testsuite' in doc)) {
    throw new Error('The report has no <testsuite> elements; is the JUnit reporter configured?');
  }
  return collect(doc);
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/junit.test.ts && npm run typecheck`
Expected: all PASS. If `XMLValidator.validate` returns a different error shape in 5.11.2, read `node_modules/fast-xml-parser/src/fxp.d.ts` for the `ValidationError` type and adjust the message line only.

- [ ] **Step 5: Commit**

```bash
git add src/junit.ts test/junit.test.ts
git commit -m "feat: parse JUnit reports into tagged test cases"
```

---

### Task 11: Trace check and baseline computation

**Files:**
- Create: `src/trace.ts`, `src/baseline.ts`
- Test: `test/trace.test.ts`, `test/baseline.test.ts`

**Interfaces:**
- Consumes: `TestCase` (Task 10); `liveRowIds`, `changeRowIds` (Task 9); `readRetires` (Task 3).
- Produces:
  - `type RowOutcome = 'passes' | 'fails' | 'not-run'`
  - `rowOutcomes(rowIds: readonly string[], cases: readonly TestCase[]): ReadonlyMap<string, RowOutcome>`
  - `requiredRows(root: string, id: string): string[]` (live ∪ change − retired, sorted)
  - `traceImplementation(required: readonly string[], cases: readonly TestCase[]): { ok: boolean; problems: readonly string[] }`
  - `interface Baseline { change: string; rows: Readonly<Record<string, 'passes'|'fails'>>; flags: readonly string[] }`
  - `computeBaseline(id: string, changeRowIds: readonly string[], live: ReadonlySet<string>, cases: readonly TestCase[], noBehaviourChange: boolean): { baseline: Baseline | null; problems: readonly string[] }`

- [ ] **Step 1: Write the failing tests**

`test/trace.test.ts`:
```ts
import { afterEach, describe, expect, it } from 'vitest';
import type { TestCase } from '../src/junit.js';
import { requiredRows, rowOutcomes, traceImplementation } from '../src/trace.js';
import { makeRepo, type TestRepo } from './helpers/repo.js';

const tc = (rowIds: string[], status: TestCase['status']): TestCase => ({ name: rowIds.map((r) => `[${r}]`).join(''), classname: 'c', status, rowIds });

describe('rowOutcomes (Review Focus 4)', () => {
  it('passes when every executed test passes; skipped never counts as executed', () => {
    const out = rowOutcomes(['A-1', 'B-2', 'C-3', 'D-4'], [
      tc(['A-1'], 'passed'), tc(['A-1'], 'skipped'),
      tc(['B-2'], 'passed'), tc(['B-2'], 'failed'),
      tc(['C-3'], 'skipped'),
    ]);
    expect(Object.fromEntries(out)).toEqual({ 'A-1': 'passes', 'B-2': 'fails', 'C-3': 'not-run', 'D-4': 'not-run' });
  });
});

describe('traceImplementation', () => {
  it('is ok only when every required row passes', () => {
    expect(traceImplementation(['A-1'], [tc(['A-1'], 'passed')])).toEqual({ ok: true, problems: [] });
    expect(traceImplementation(['A-1', 'B-2'], [tc(['A-1'], 'failed')])).toEqual({
      ok: false,
      problems: ['A-1: failing', 'B-2: no executed test'],
    });
  });
});

describe('requiredRows', () => {
  let repo: TestRepo;
  afterEach(() => repo?.cleanup());
  it('is live rows plus change rows minus retired rows', () => {
    const t = (ids: string[]): string => ['| ID | x | Expected |', '|---|---|---|', ...ids.map((i) => `| ${i} | 1 | 2 |`)].join('\n');
    repo = makeRepo({
      'docs/specs/a/spec.md': t(['LST-001', 'LST-002']),
      'docs/changes/c1/spec-delta.md': t(['LST-003']),
      'docs/changes/c1/retires.json': '["LST-002"]',
    });
    expect(requiredRows(repo.root, 'c1')).toEqual(['LST-001', 'LST-003']);
  });
});
```

`test/baseline.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { computeBaseline } from '../src/baseline.js';
import type { TestCase } from '../src/junit.js';

const tc = (id: string, status: TestCase['status']): TestCase => ({ name: `[${id}]`, classname: 'c', status, rowIds: [id] });
const live = new Set(['LST-001']);

describe('computeBaseline', () => {
  it('records passes and fails and requires at least one failing row', () => {
    const r = computeBaseline('c1', ['LST-001', 'LST-002'], live, [tc('LST-001', 'passed'), tc('LST-002', 'failed')], false);
    expect(r.problems).toEqual([]);
    expect(r.baseline).toEqual({ change: 'c1', rows: { 'LST-001': 'passes', 'LST-002': 'fails' }, flags: [] });
  });
  it('rejects a behaviour change where nothing fails at baseline', () => {
    const r = computeBaseline('c1', ['LST-001'], live, [tc('LST-001', 'passed')], false);
    expect(r.baseline).toBeNull();
    expect(r.problems[0]).toMatch(/At least one row must fail/);
  });
  it('accepts all-passing rows when the change declares no behaviour change', () => {
    expect(computeBaseline('c1', ['LST-001'], live, [tc('LST-001', 'passed')], true).baseline?.rows).toEqual({ 'LST-001': 'passes' });
  });
  it('rejects a declared refactor whose rows fail', () => {
    expect(computeBaseline('c1', ['LST-001'], live, [tc('LST-001', 'failed')], true).problems[0]).toMatch(/declares no behaviour change/);
  });
  it('flags a new row that already passes', () => {
    const r = computeBaseline('c1', ['LST-002', 'LST-003'], live, [tc('LST-002', 'passed'), tc('LST-003', 'failed')], false);
    expect(r.baseline?.flags).toEqual(['LST-002 is new in this change but already passes on main: weak test or existing behaviour. Decide before approving.']);
  });
  it('refuses rows with no executed test', () => {
    const r = computeBaseline('c1', ['LST-002'], live, [tc('LST-002', 'skipped')], false);
    expect(r.baseline).toBeNull();
    expect(r.problems).toEqual(['LST-002: no executed test at baseline']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/trace.test.ts test/baseline.test.ts`
Expected: FAIL, unresolved imports.

- [ ] **Step 3: Write the implementation**

`src/trace.ts`:
```ts
import { readRetires } from './change.js';
import type { TestCase } from './junit.js';
import { changeRowIds, liveRowIds } from './spec-index.js';

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

export function requiredRows(root: string, id: string): string[] {
  const retired = readRetires(root, id);
  const all = new Set([...liveRowIds(root), ...changeRowIds(root, id)]);
  return [...all].filter((r) => !retired.has(r)).sort();
}

export function traceImplementation(required: readonly string[], cases: readonly TestCase[]): { ok: boolean; problems: readonly string[] } {
  const problems = [...rowOutcomes(required, cases)]
    .filter(([, o]) => o !== 'passes')
    .map(([r, o]) => `${r}: ${o === 'not-run' ? 'no executed test' : 'failing'}`);
  return { ok: problems.length === 0, problems };
}
```

`src/baseline.ts`:
```ts
import type { TestCase } from './junit.js';
import { rowOutcomes } from './trace.js';

export interface Baseline {
  readonly change: string;
  readonly rows: Readonly<Record<string, 'passes' | 'fails'>>;
  readonly flags: readonly string[];
}

export function computeBaseline(
  id: string,
  changeRowIds: readonly string[],
  live: ReadonlySet<string>,
  cases: readonly TestCase[],
  noBehaviourChange: boolean,
): { baseline: Baseline | null; problems: readonly string[] } {
  const outcomes = [...rowOutcomes(changeRowIds, cases)];
  const notRun = outcomes.filter(([, o]) => o === 'not-run').map(([r]) => `${r}: no executed test at baseline`);
  if (notRun.length > 0) return { baseline: null, problems: notRun };
  const rows = Object.fromEntries(outcomes) as Record<string, 'passes' | 'fails'>;
  const failing = Object.values(rows).filter((o) => o === 'fails').length;
  const problems = noBehaviourChange
    ? failing > 0 ? ['The change declares no behaviour change, but some rows fail at baseline'] : []
    : failing === 0 ? ['At least one row must fail at baseline, or declare "noBehaviourChange": true in change.json'] : [];
  if (problems.length > 0) return { baseline: null, problems };
  const flags = Object.entries(rows)
    .filter(([r, o]) => o === 'passes' && !live.has(r))
    .map(([r]) => `${r} is new in this change but already passes on main: weak test or existing behaviour. Decide before approving.`);
  return { baseline: Object.freeze({ change: id, rows, flags }), problems: [] };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/trace.test.ts test/baseline.test.ts && npm run typecheck`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/trace.ts src/baseline.ts test/trace.test.ts test/baseline.test.ts
git commit -m "feat: add trace check and baseline rules"
```

---

### Task 12: Running the baseline in a temporary worktree

**Files:**
- Create: `src/exec.ts`, `src/run-baseline.ts`, `test/helpers/fake-runner.mjs`
- Test: `test/run-baseline.test.ts`

**Interfaces:**
- Consumes: `loadConfig` (Task 3); `readChange` (Task 3); `promote` (Task 8); `parseJUnit` (Task 10); `computeBaseline` (Task 11); `changeRowIds`, `liveRowIds` (Task 9); `canonicalJson`; `changeDir`, `fromRepoPath`, `toRepoPath`.
- Produces:
  - `interface ExecResult { status: number; stdout: string; stderr: string }`, `type Exec = (cmd: string, args: readonly string[], cwd: string) => ExecResult`, `realExec: Exec`
  - `runBaseline(root: string, id: string, exec?: Exec): { baseline: Baseline | null; problems: readonly string[] }`. On success it writes `docs/changes/<id>/baseline.json`.

Behaviour: refuses if the change's `tests/` folder has uncommitted changes → `git worktree add --detach <tmp> HEAD` → `promote` tests inside the worktree → run `test.setup` (must exit 0) → run `test.command` (non-zero exit is expected when rows fail) → require the JUnit report → compute → write `baseline.json` in the **original** checkout → always remove the worktree.

- [ ] **Step 1: Write the fake runner**

`test/helpers/fake-runner.mjs`:
```js
// Test double for a project's test command. Reads tests/acceptance/rows.json (staged into the
// worktree by `wf promote`) and writes a JUnit report. A row passes if it is marked existing or
// if src/impl/<ROW-ID> exists. FAKE_NO_REPORT=1 simulates a runner without a JUnit reporter.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

if (process.env.FAKE_NO_REPORT === '1') process.exit(1);
const spec = existsSync('tests/acceptance/rows.json')
  ? JSON.parse(readFileSync('tests/acceptance/rows.json', 'utf8'))
  : { rows: [] };
const cases = spec.rows.map((r) => {
  const pass = r.existing === true || existsSync(`src/impl/${r.id}`);
  const body = pass ? '' : '<failure message="behaviour missing"/>';
  return `<testcase classname="acceptance" name="[${r.id}] ${r.title}">${body}</testcase>`;
});
mkdirSync('reports', { recursive: true });
writeFileSync('reports/junit.xml', `<?xml version="1.0"?><testsuites><testsuite name="acceptance">${cases.join('')}</testsuite></testsuites>`);
process.exit(cases.some((c) => c.includes('<failure')) ? 1 : 0);
```

- [ ] **Step 2: Write the failing test**

`test/run-baseline.test.ts`:
```ts
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { realExec, type Exec } from '../src/exec.js';
import { runBaseline } from '../src/run-baseline.js';
import { git, makeRepo, type TestRepo } from './helpers/repo.js';

let repo: TestRepo;
afterEach(() => repo?.cleanup());
const runner = resolve('test/helpers/fake-runner.mjs');
const C = 'docs/changes/c1';
const table = '| ID | Price | Expected |\n|---|---|---|\n| LST-001 | 1 | 201 |\n| LST-002 | 0 | 422 |\n';
const rowsJson = JSON.stringify({ rows: [{ id: 'LST-001', title: 'valid', existing: true }, { id: 'LST-002', title: 'rejects 0' }] });

function setup(extraConfig: Record<string, unknown> = {}): void {
  repo = makeRepo({
    'workflow.config.json': JSON.stringify({ approvers: ['tassi'], test: { command: ['node', runner], junitReport: 'reports/junit.xml', ...extraConfig } }),
    'docs/specs/listing/spec.md': '| ID | Price | Expected |\n|---|---|---|\n| LST-001 | 1 | 201 |\n',
    [`${C}/spec-delta.md`]: table,
    [`${C}/change.json`]: '{"level":"P1","noBehaviourChange":false}',
    [`${C}/tests/stage/tests/acceptance/rows.json`]: rowsJson,
  });
  git(repo.root, 'init', '-q', '-b', 'main');
  git(repo.root, 'add', '.');
  git(repo.root, 'commit', '-q', '-m', 'init');
}

describe('runBaseline', () => {
  it('runs staged tests in a temp worktree and writes baseline.json', () => {
    setup();
    const r = runBaseline(repo.root, 'c1');
    expect(r.problems).toEqual([]);
    expect(JSON.parse(readFileSync(join(repo.root, C, 'baseline.json'), 'utf8')).rows).toEqual({ 'LST-001': 'passes', 'LST-002': 'fails' });
    expect(existsSync(join(repo.root, 'tests', 'acceptance', 'rows.json'))).toBe(false);
    expect(git(repo.root, 'worktree', 'list').trim().split('\n')).toHaveLength(1);
  });

  it('refuses when staged tests are not committed', () => {
    setup();
    repo.write(`${C}/tests/stage/tests/acceptance/extra.test.ts`, 'x');
    expect(() => runBaseline(repo.root, 'c1')).toThrow(/Commit the staged tests/);
  });

  it('errors when the test command writes no JUnit report, and cleans up (Review Focus 3)', () => {
    setup();
    const exec: Exec = (cmd, args, cwd) => realExec(cmd === 'node' ? 'env' : cmd, cmd === 'node' ? ['FAKE_NO_REPORT=1', 'node', ...args] : args, cwd);
    expect(() => runBaseline(repo.root, 'c1', exec)).toThrow(/did not write reports\/junit\.xml/);
    expect(existsSync(join(repo.root, C, 'baseline.json'))).toBe(false);
    expect(git(repo.root, 'worktree', 'list').trim().split('\n')).toHaveLength(1);
  });

  it('fails when the setup command fails', () => {
    setup({ setup: ['node', '-e', 'process.exit(3)'] });
    expect(() => runBaseline(repo.root, 'c1')).toThrow(/Setup command failed/);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run test/run-baseline.test.ts`
Expected: FAIL, unresolved imports.

- [ ] **Step 4: Write the implementation**

`src/exec.ts`:
```ts
import { spawnSync } from 'node:child_process';

export interface ExecResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type Exec = (cmd: string, args: readonly string[], cwd: string) => ExecResult;

export const realExec: Exec = (cmd, args, cwd) => {
  const r = spawnSync(cmd, [...args], { cwd, encoding: 'utf8', shell: false, maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new Error(`Could not run ${cmd}: ${r.error.message}`);
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
};
```

`src/run-baseline.ts`:
```ts
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeBaseline, type Baseline } from './baseline.js';
import { readChange } from './change.js';
import { loadConfig } from './config.js';
import { realExec, type Exec } from './exec.js';
import { canonicalJson } from './hash.js';
import { parseJUnit } from './junit.js';
import { changeDir, fromRepoPath, toRepoPath } from './paths.js';
import { changeRowIds, liveRowIds } from './spec-index.js';
import { promote } from './stage.js';

function runIn(exec: Exec, command: readonly string[], cwd: string): number {
  const [cmd, ...args] = command;
  if (cmd === undefined) throw new Error('Empty command');
  return exec(cmd, args, cwd).status;
}

export function runBaseline(root: string, id: string, exec: Exec = realExec): { baseline: Baseline | null; problems: readonly string[] } {
  const config = loadConfig(root);
  const meta = readChange(root, id);
  const testsDir = toRepoPath(root, join(changeDir(root, id), 'tests'));
  if (exec('git', ['status', '--porcelain', '--', testsDir], root).stdout.trim() !== '') {
    throw new Error('Commit the staged tests before running the baseline: it runs against a clean checkout of HEAD');
  }
  const tmp = mkdtempSync(join(tmpdir(), 'wf-baseline-'));
  const wt = join(tmp, 'wt');
  const add = exec('git', ['worktree', 'add', '--detach', wt, 'HEAD'], root);
  if (add.status !== 0) throw new Error(`git worktree add failed: ${add.stderr.trim()}`);
  try {
    promote(wt, id, 'tests');
    if (config.test.setup && runIn(exec, config.test.setup, wt) !== 0) {
      throw new Error(`Setup command failed: ${config.test.setup.join(' ')}`);
    }
    runIn(exec, config.test.command, wt);
    const report = fromRepoPath(wt, config.test.junitReport);
    if (!existsSync(report)) {
      throw new Error(`The test command did not write ${config.test.junitReport}. Configure your runner's JUnit reporter.`);
    }
    const cases = parseJUnit(readFileSync(report, 'utf8'));
    const outcome = computeBaseline(id, changeRowIds(root, id), liveRowIds(root), cases, meta.noBehaviourChange);
    if (outcome.baseline) writeFileSync(join(changeDir(root, id), 'baseline.json'), canonicalJson(outcome.baseline));
    return outcome;
  } finally {
    exec('git', ['worktree', 'remove', '--force', wt], root);
    rmSync(tmp, { recursive: true, force: true });
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/run-baseline.test.ts && npm run typecheck`
Expected: all PASS. If macOS resolves the temp worktree through `/private/var`, `git worktree remove` still works because it receives the same path that `add` created.

- [ ] **Step 6: Commit**

```bash
git add src/exec.ts src/run-baseline.ts test/helpers/fake-runner.mjs test/run-baseline.test.ts
git commit -m "feat: run baselines in a temp worktree"
```

---

### Task 13: Memory check

**Files:**
- Create: `src/memory-check.ts`
- Test: `test/memory-check.test.ts`

**Interfaces:**
- Consumes: `openChangeIds` (Task 9); `changeDir`; `Issue`.
- Produces: `memoryCheck(root: string): Issue[]`

Rules for v1:
- `docs/context.md` must exist and be at most 150 lines.
- Relative markdown links in `docs/context.md` must resolve. Skip `http(s):`, `mailto:` and `#…`.
- `docs/glossary.md` must exist.
- Every open change with `approvals/tests.json` must have `decisions-audit.md`.

- [ ] **Step 1: Write the failing test**

`test/memory-check.test.ts`:
```ts
import { afterEach, describe, expect, it } from 'vitest';
import { memoryCheck } from '../src/memory-check.js';
import { makeRepo, type TestRepo } from './helpers/repo.js';

let repo: TestRepo;
afterEach(() => repo?.cleanup());
const base = { 'docs/context.md': '# Context\nSee [specs](specs/) and [site](https://x.dev) and [top](#top).\n', 'docs/glossary.md': '# Glossary\n', 'docs/specs/.keep': '' };

describe('memoryCheck', () => {
  it('passes a healthy repo', () => {
    repo = makeRepo(base);
    expect(memoryCheck(repo.root)).toEqual([]);
  });
  it('reports a missing context.md and glossary.md', () => {
    repo = makeRepo();
    expect(memoryCheck(repo.root).map((i) => i.message)).toEqual(['docs/context.md is missing', 'docs/glossary.md is missing']);
  });
  it('reports a context.md over 150 lines', () => {
    repo = makeRepo({ ...base, 'docs/context.md': Array.from({ length: 151 }, (_, i) => `line ${i}`).join('\n') });
    expect(memoryCheck(repo.root).map((i) => i.message)).toContain('docs/context.md has 151 lines; the limit is 150');
  });
  it('reports a broken relative link with its line number', () => {
    repo = makeRepo({ ...base, 'docs/context.md': '# C\n\nRead [the plan](plans/missing.md).\n' });
    expect(memoryCheck(repo.root)).toEqual([{ file: 'docs/context.md', line: 3, message: 'Broken link: plans/missing.md' }]);
  });
  it('requires decisions-audit.md once a change has a tests approval', () => {
    repo = makeRepo({ ...base, 'docs/changes/c1/approvals/tests.json': '{}' });
    expect(memoryCheck(repo.root).map((i) => i.message)).toEqual(['Change c1 has approved tests but no decisions-audit.md']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/memory-check.test.ts`
Expected: FAIL, unresolved import.

- [ ] **Step 3: Write the implementation**

`src/memory-check.ts`:
```ts
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { changeDir } from './paths.js';
import { openChangeIds } from './spec-index.js';
import type { Issue } from './types.js';

const MAX_CONTEXT_LINES = 150;
const LINK = /\[[^\]]*\]\(([^)\s]+)\)/g;

function contextIssues(root: string): Issue[] {
  const file = 'docs/context.md';
  const abs = join(root, 'docs', 'context.md');
  if (!existsSync(abs)) return [{ file, line: 0, message: `${file} is missing` }];
  const lines = readFileSync(abs, 'utf8').replace(/\r?\n$/, '').split(/\r?\n/);
  const size: Issue[] = lines.length > MAX_CONTEXT_LINES
    ? [{ file, line: 0, message: `${file} has ${lines.length} lines; the limit is ${MAX_CONTEXT_LINES}` }]
    : [];
  const links = lines.flatMap((text, i) =>
    [...text.matchAll(LINK)]
      .map((m) => m[1] ?? '')
      .filter((target) => !/^(https?:|mailto:|#)/.test(target))
      .filter((target) => !existsSync(join(dirname(abs), target.split('#')[0] ?? '')))
      .map((target): Issue => ({ file, line: i + 1, message: `Broken link: ${target}` })),
  );
  return [...size, ...links];
}

export function memoryCheck(root: string): Issue[] {
  const glossary: Issue[] = existsSync(join(root, 'docs', 'glossary.md'))
    ? []
    : [{ file: 'docs/glossary.md', line: 0, message: 'docs/glossary.md is missing' }];
  const audits = openChangeIds(root)
    .filter((id) => existsSync(join(changeDir(root, id), 'approvals', 'tests.json')))
    .filter((id) => !existsSync(join(changeDir(root, id), 'decisions-audit.md')))
    .map((id): Issue => ({ file: `docs/changes/${id}/decisions-audit.md`, line: 0, message: `Change ${id} has approved tests but no decisions-audit.md` }));
  return [...contextIssues(root), ...glossary, ...audits];
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/memory-check.test.ts && npm run typecheck`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/memory-check.ts test/memory-check.test.ts
git commit -m "feat: add memory check"
```

---

### Task 14: CLI wiring

**Files:**
- Create: `src/cli.ts`, `src/bin.ts`
- Test: `test/cli.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `interface Io { out(s: string): void; err(s: string): void; cwd: string; exec?: Exec }`
  - `run(argv: readonly string[], io: Io): number`

Commands and exit codes:

| Command | Prints | Exit |
|---|---|---|
| `wf approve <id> <spec\|design\|tests>` | path written + reminder that the record counts only once your account merges its PR | 0, or 2 on refusal |
| `wf gate-check <id> [gate]` | one line per gate: `<gate>  <status>` then indented problems | 0 if all valid, else 1 |
| `wf promote <id> <design\|tests>` | each live path written | 0 |
| `wf stage-check <id>` | mismatches for design and tests | 0 / 1 |
| `wf baseline <id>` | rows, flags, problems | 0 / 1 |
| `wf trace-check <id> --report <path>` | problems | 0 / 1 |
| `wf spec-lint <id>` | `file:line message` | 0 / 1 |
| `wf memory-check` | `file:line message` | 0 / 1 |
| anything else / `--help` | usage | 2 (0 for `--help`) |

All commands accept `--root <dir>` (default: cwd).

- [ ] **Step 1: Write the failing test**

`test/cli.test.ts`:
```ts
import { afterEach, describe, expect, it } from 'vitest';
import { run } from '../src/cli.js';
import { makeRepo, type TestRepo } from './helpers/repo.js';

let repo: TestRepo;
afterEach(() => repo?.cleanup());
const C = 'docs/changes/c1';

function cli(...argv: string[]): { code: number; out: string; err: string } {
  const out: string[] = [];
  const err: string[] = [];
  const code = run(argv, { out: (s) => out.push(s), err: (s) => err.push(s), cwd: repo.root });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

describe('wf cli', () => {
  it('prints usage for --help with exit 0 and for unknown commands with exit 2', () => {
    repo = makeRepo();
    expect(cli('--help').code).toBe(0);
    const r = cli('frobnicate');
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/Usage: wf/);
  });

  it('approves a gate and reports it valid', () => {
    repo = makeRepo({ [`${C}/proposal.md`]: 'p', [`${C}/spec-delta.md`]: 's', [`${C}/change.json`]: '{"level":"P1","noBehaviourChange":false}' });
    const a = cli('approve', 'c1', 'spec');
    expect(a.code).toBe(0);
    expect(a.out).toMatch(/approvals\/spec\.json/);
    expect(a.out).toMatch(/only counts once your account merges/);
    const g = cli('gate-check', 'c1', 'spec');
    expect(g.code).toBe(0);
    expect(g.out).toMatch(/spec\s+valid/);
  });

  it('exits 1 with problems when a gate is not valid', () => {
    repo = makeRepo();
    const g = cli('gate-check', 'c1');
    expect(g.code).toBe(1);
    expect(g.out).toMatch(/spec\s+missing/);
  });

  it('exits 2 with a message on invalid input instead of crashing', () => {
    repo = makeRepo();
    expect(cli('approve', 'Bad_ID', 'spec')).toMatchObject({ code: 2 });
    expect(cli('approve', 'c1', 'nonsense').err).toMatch(/gate must be one of spec, design, tests/);
    expect(cli('promote', 'c1', 'spec').err).toMatch(/promote takes design or tests/);
    expect(cli('trace-check', 'c1').err).toMatch(/--report/);
  });

  it('runs spec-lint and memory-check', () => {
    repo = makeRepo({ [`${C}/spec-delta.md`]: '| ID | x | Expected |\n|---|---|---|\n| LST-001 | 1 | 2 |\n| LST-001 | 1 | 2 |' });
    const l = cli('spec-lint', 'c1');
    expect(l.code).toBe(1);
    expect(l.out).toMatch(/spec-delta\.md:4 Row ID LST-001 appears more than once/);
    expect(cli('memory-check').code).toBe(1);
  });

  it('promotes and stage-checks', () => {
    repo = makeRepo({ [`${C}/tests/stage/tests/acceptance/a.test.ts`]: 't' });
    expect(cli('stage-check', 'c1').code).toBe(1);
    expect(cli('promote', 'c1', 'tests').out).toMatch(/tests\/acceptance\/a\.test\.ts/);
    expect(cli('stage-check', 'c1').code).toBe(0);
  });

  it('trace-checks a JUnit report', () => {
    repo = makeRepo({
      [`${C}/spec-delta.md`]: '| ID | x | Expected |\n|---|---|---|\n| LST-001 | 1 | 2 |',
      'reports/junit.xml': '<testsuite name="s"><testcase classname="c" name="[LST-001] ok"/></testsuite>',
    });
    expect(cli('trace-check', 'c1', '--report', 'reports/junit.xml').code).toBe(0);
    repo.write('reports/junit.xml', '<testsuite name="s"><testcase classname="c" name="[LST-001] ok"><failure/></testcase></testsuite>');
    const t = cli('trace-check', 'c1', '--report', 'reports/junit.xml');
    expect(t.code).toBe(1);
    expect(t.out).toMatch(/LST-001: failing/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/cli.test.ts`
Expected: FAIL, unresolved import.

- [ ] **Step 3: Write the implementation**

`src/cli.ts`:
```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { approve } from './approve.js';
import type { Exec } from './exec.js';
import { checkAll, checkGate } from './gate-check.js';
import { parseJUnit } from './junit.js';
import { memoryCheck } from './memory-check.js';
import { assertChangeId, fromRepoPath, toRepoPath } from './paths.js';
import { runBaseline } from './run-baseline.js';
import { lintChange } from './spec-lint.js';
import { checkStage, promote } from './stage.js';
import { requiredRows, traceImplementation } from './trace.js';
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

function dispatch(cmd: string | undefined, pos: readonly string[], root: string, report: string | undefined, io: Io): number {
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
      const id = needId(pos[0]);
      return showProblems(io, STAGE_GATES.flatMap((g) => checkStage(root, id, g).map((m) => `${g}: ${m.livePath} is ${m.reason === 'missing' ? 'missing' : 'different from approved staging'}`)));
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
      const cases = parseJUnit(readFileSync(fromRepoPath(root, report), 'utf8'));
      return showProblems(io, traceImplementation(requiredRows(root, id), cases).problems);
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
```

`src/bin.ts`:
```ts
#!/usr/bin/env node
import { run } from './cli.js';

process.exitCode = run(process.argv.slice(2), {
  out: (s) => process.stdout.write(`${s}\n`),
  err: (s) => process.stderr.write(`${s}\n`),
  cwd: process.cwd(),
});
```

- [ ] **Step 4: Run the tests and a real build**

Run: `npx vitest run test/cli.test.ts && npm run typecheck && npm run build && node dist/bin.js --help`
Expected: tests PASS; build writes `dist/`; `--help` prints the usage and exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts src/bin.ts test/cli.test.ts
git commit -m "feat: wire wf command-line interface"
```

---

### Task 15: End-to-end flow and coverage gate

**Files:**
- Test: `test/e2e.test.ts`

**Interfaces:**
- Consumes: `run` (Task 14), test helpers (Tasks 2 and 12).
- Produces: a single scenario test that replays the lifecycle from the visual demo, plus a passing coverage threshold.

- [ ] **Step 1: Write the end-to-end test**

`test/e2e.test.ts`:
```ts
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { run } from '../src/cli.js';
import { git, makeRepo, type TestRepo } from './helpers/repo.js';

let repo: TestRepo;
afterEach(() => repo?.cleanup());
const C = 'docs/changes/listing-price-limits';
const runner = resolve('test/helpers/fake-runner.mjs');

function wf(...argv: string[]): { code: number; out: string } {
  const out: string[] = [];
  const code = run(argv, { out: (s) => out.push(s), err: (s) => out.push(s), cwd: repo.root });
  return { code, out: out.join('\n') };
}
const commit = (msg: string): void => {
  git(repo.root, 'add', '.');
  git(repo.root, 'commit', '-q', '-m', msg);
};

describe('full change lifecycle', () => {
  it('gates, stages, baselines and traces a change; catches tampering', () => {
    repo = makeRepo({
      'workflow.config.json': JSON.stringify({ approvers: ['tassi'], test: { command: ['node', runner], junitReport: 'reports/junit.xml' } }),
      'docs/context.md': '# Context\n', 'docs/glossary.md': '# Glossary\n',
      'docs/specs/listing/spec.md': '| ID | Price | Expected |\n|---|---|---|\n| LST-001 | 999999 | 201 |\n',
      [`${C}/proposal.md`]: 'Limit prices.',
      [`${C}/change.json`]: '{"level":"P1","noBehaviourChange":false}',
      [`${C}/spec-delta.md`]: '| ID | Price | Expected |\n|---|---|---|\n| LST-002 | 0 | 422 |\n| LST-003 | 1000001 | 422 |\n',
    });
    git(repo.root, 'init', '-q', '-b', 'main');
    commit('init');

    expect(wf('spec-lint', 'listing-price-limits').code).toBe(0);
    expect(wf('approve', 'listing-price-limits', 'spec').code).toBe(0);

    repo.write(`${C}/design/design.md`, 'Validate price in the API.');
    repo.write(`${C}/design/stage/packages/contracts/openapi.yaml`, 'price: { type: integer, minimum: 1, maximum: 1000000 }\n');
    expect(wf('approve', 'listing-price-limits', 'design').code).toBe(0);

    repo.write(`${C}/tests/stage/tests/acceptance/rows.json`, JSON.stringify({ rows: [
      { id: 'LST-001', title: 'accepts max', existing: true },
      { id: 'LST-002', title: 'rejects 0' },
      { id: 'LST-003', title: 'rejects over limit' },
    ] }));
    commit('stage tests');
    const b = wf('baseline', 'listing-price-limits');
    expect(b.code).toBe(0);
    expect(b.out).toMatch(/LST-002 fails/);
    expect(wf('approve', 'listing-price-limits', 'tests').code).toBe(0);
    expect(wf('gate-check', 'listing-price-limits').code).toBe(0);

    // Edit the spec after approval: spec changed, everything downstream blocked.
    repo.write(`${C}/proposal.md`, 'Limit prices (edited).');
    expect(wf('gate-check', 'listing-price-limits').out).toMatch(/spec\s+changed[\s\S]*design\s+blocked[\s\S]*tests\s+blocked/);
    wf('approve', 'listing-price-limits', 'spec');
    expect(wf('gate-check', 'listing-price-limits').out).toMatch(/design\s+stale/);
    wf('approve', 'listing-price-limits', 'design');
    wf('approve', 'listing-price-limits', 'tests');
    expect(wf('gate-check', 'listing-price-limits').code).toBe(0);

    // Implementation: promote staging, add code, run tests, trace.
    wf('promote', 'listing-price-limits', 'design');
    wf('promote', 'listing-price-limits', 'tests');
    repo.write('src/impl/LST-002', 'done');
    repo.write('src/impl/LST-003', 'done');
    expect(wf('stage-check', 'listing-price-limits').code).toBe(0);
    spawnSync('node', [runner], { cwd: repo.root });
    expect(wf('trace-check', 'listing-price-limits', '--report', 'reports/junit.xml').code).toBe(0);

    // A builder loosens a promoted test file: byte-identity fails.
    repo.write('tests/acceptance/rows.json', JSON.stringify({ rows: [] }));
    expect(wf('stage-check', 'listing-price-limits').out).toMatch(/tests\/acceptance\/rows\.json is different from approved staging/);
  });
});
```

- [ ] **Step 2: Run the end-to-end test**

Run: `npx vitest run test/e2e.test.ts`
Expected: PASS. Every module already exists, so this test should pass straight away. If it fails, the failure is a real integration bug: fix the module, not the test.

- [ ] **Step 3: Run the full suite with coverage**

Run: `npm run typecheck && npm run coverage`
Expected: all tests PASS; coverage ≥ 80% on lines, branches, functions and statements (the run fails otherwise). If branches fall short, add tests for the uncovered branches the report names. Don't lower the threshold.

- [ ] **Step 4: Commit**

```bash
git add test/e2e.test.ts
git commit -m "test: add end-to-end change lifecycle"
```

---

## Self-review notes (done while writing)
- **Spec coverage.** This plan covers chained approvals, staging + byte-identity, baseline rules (≥1 fail, `noBehaviourChange`, new-row flag), trace-check over live + change − retired, spec-lint, memory-check, and refusing symlinks and unsafe paths.
- **Deliberately out of scope**, assigned to Plans 2–5:
  - provenance (merged by an approver) → Plan 2;
  - CI templates and rulesets → Plan 2;
  - `wf init` / `upgrade` → Plan 3;
  - roles, hooks, runner and orchestration → Plan 4;
  - the trial itself → Plan 5.
- **Consistency.** Spec amendments in Task 0 match the code (stage mirrors, `change.json`, `retires.json`, `wf promote`, JUnit tags).
- **Known v1 limits, documented rather than hidden:**
  - pipes inside table cells aren't supported;
  - lessons stage/warrant checks aren't in memory-check yet (Plan 3 adds them with the templates);
  - spec-lint doesn't yet check glossary terms or missing authz rows.
