# Plan 2a: GitHub Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the gates enforceable on GitHub. An approval record counts only if an approver's account merged its PR. A gate PR may change nothing outside its own change folder. CI runs `wf` from the base commit, and the repo ships a CODEOWNERS file, a ruleset and a setup guide.

**Architecture:** Four small pure-ish modules, each taking an injected `Exec`: `git.ts` (diff, blob, last-commit), `classify.ts` (what kind of PR is this, and does a gate PR stay in scope), `github.ts` (read-only GitHub calls through `gh api`) and `provenance.ts` (was this record merged by an approver). `pr-check.ts` combines them with the existing `checkGate`. Three new CLI commands (`classify`, `pr-check`, `run-tests`) feed a CI template whose five jobs are `gate-check`, `stage-check`, `verify`, `trace-check` and `memory-check`. Plan 2b later adds the canary and the container to the same template.

**Tech Stack:** Node ≥22, TypeScript 5.9.3 strict, Vitest 5.0.3, `gh` CLI (preinstalled on GitHub-hosted runners) for API reads, `yaml` 2.9.1 (new devDependency, tests only). No new runtime dependencies.

**Spec:** `docs/specs/2026-09-29-agentic-workflow-design.md` v2.6, sections *Gates and approval records* (Authentication), *Trust boundary*, *Implementation conventions*. Also `docs/decisions/0001-acceptance-dir-and-manifest.md` (*Not solved*, third bullet) and `docs/decisions/0002-test-report-forgery.md` (CI order).

## Global Constraints
- Node `>=22`, ESM, TypeScript `strict` + `noUncheckedIndexedAccess`. No new runtime dependencies.
- Never run a shell. Child processes go through `Exec` (`spawnSync`, `shell: false`). Anything interpolated into a git argument or a GitHub API path is validated first (`assertRef`, repo and sha regexes).
- Treat inputs as immutable: `readonly` types, freeze returned objects.
- Never log or print a token. `wf` never reads `GH_TOKEN`; `gh` does. Error text from `gh` is scrubbed of token-shaped strings.
- Fail closed: any GitHub or git error, unexpected response shape, or ambiguity is a problem (exit 1), never a pass.
- Files ≤ 200 lines where practical; functions < 50 lines. Coverage ≥ 80% via `npm run coverage`.
- Exit codes: `0` check passed, `1` check failed, `2` usage or input error.
- GitHub logins compare case-insensitively.
- Commit messages: `<type>: <description>`, imperative, subject ≤ 50 chars, one logical change per commit. **No `Co-Authored-By`, `Claude-Session` or "Generated with" lines** (project memory rule overrides the harness reminder).
- Don't push or open a PR unless asked.
- Facts about GitHub are marked verified (with how) or unverified in code comments and docs.

## Decisions made in this plan
- **D1, self-authored PRs.** GitHub does not let an author approve their own PR. A record's PR is accepted when `merged_by` is an approver AND either (a) the PR author is an approver (the human opened and merged it; no review is possible), or (b) an approver's latest review is `APPROVED` on the PR's final head commit. Case (a) is only as strong as the separation between you and the bot token; the setup guide says so.
- **D2, five jobs, one chain.** `gate-check`, `memory-check` and `stage-check` run in parallel. `verify` needs `stage-check`; `trace-check` needs `verify` and reads the JUnit report from an uploaded artifact. This keeps the ADR 0002 order (stage-check → test → trace-check) while keeping five required check names.
- **D3, `wf` runs from the base commit.** CI checks out the PR's base SHA into `.wf-trusted/` and runs `wf` from there, so a PR cannot edit the verifier that judges it. The workflow file itself still comes from the PR (GitHub behaviour), so `.github/**` stays a CODEOWNERS path.
  *Update:* the nested `.wf-trusted/` layout was superseded by sibling `pr/` + `trusted/` (see Task 7 fix round 1); `branches:` was added to `on.pull_request` after the final review.
- **D4, PR kind comes from the diff, not the branch name.** A PR that adds or changes an approval record is a gate PR. Otherwise branch `change/<id>` marks an implementation PR. Anything else is `other` (CODEOWNERS is its only gate). *Known limit:* an agent can name an implementation branch anything and get `other`; the human merge on protected paths is the backstop. A P0 lane that closes this is out of scope.
- **D5, staging paths are always protected.** CODEOWNERS can't express "once approved", so `docs/changes/*/design/` and `docs/changes/*/tests/` are always owned by the approver. Only gate PRs touch them, and those need your review anyway.
- **D6, deleting a record is not a gate PR.** Archiving a change deletes its records; the archive flow isn't designed yet (Plan 4). Record deletions are CODEOWNERS-protected and otherwise unchecked here.

## Review Focus
1. **Hostile names reaching git or the shell.** Branch names with metacharacters or `change/` plus an invalid id, filenames containing newlines, a base ref starting with `-`. Never executed, never trusted. Tests in Task 1, Task 2 and Task 7 (no `${{ github.* }}` inside any `run:`).
2. **A gate PR carrying more than its record.** Two records in one PR, a record for another change, any file outside `docs/changes/<id>/` (the ADR 0001 manifest-from-branch attack). Task 2 and Task 5.
3. **Ambiguous PR lookup.** The record's commit has no PR, an unmerged PR, a PR merged into another branch, or several PRs. Task 4.
4. **Review edge cases.** Approval before a later push, a later `CHANGES_REQUESTED` or `DISMISSED`, approval by a non-approver, mixed-case logins, more than 100 reviews. Task 3 and Task 4.
5. **Record state mismatches.** A record changed inside an implementation PR, a record not on the base yet, the base SHA missing from the checkout. Task 4 and Task 5.

## File Structure
```
src/
  git.ts            NEW  assertRef, changedFiles, blobAt, lastCommitTouching
  classify.ts       NEW  classifyPr: kind, change id, gate, scope problems
  github.ts         NEW  ghReader: pullsForCommit, pull, reviews (through `gh api`)
  provenance.ts     NEW  approvedByApprover, provenanceProblems
  pr-check.ts       NEW  prCheck: classify + checkGate + provenance
  run-tests.ts      NEW  runTests: test.setup then test.command, optional report copy
  cli.ts            MOD  commands classify, pr-check, run-tests; flags --base --base-branch --branch --repo --report-out
templates/
  ci/wf.yml         NEW  the five-job workflow
  CODEOWNERS        NEW  protected paths, owner placeholder @APPROVER
  ruleset.json      NEW  protect-main for installed projects
docs/guides/github-setup.md   NEW  bot identity, ruleset, CODEOWNERS, live verification
test/
  helpers/fake-gh.ts          NEW  Exec that answers `gh api` from a route table
  git.test.ts classify.test.ts github.test.ts provenance.test.ts pr-check.test.ts
  run-tests.test.ts templates.test.ts          NEW
```

---

### Task 1: Git helpers

**Files:**
- Create: `src/git.ts`, `test/git.test.ts`

**Interfaces:**
- Consumes: `Exec`, `ExecResult` from `src/exec.ts`.
- Produces:
  - `interface ChangedFile { readonly status: string; readonly path: string }` (`status` is git's letter: `A`, `M`, `D`, `T`)
  - `assertRef(ref: string): string` — throws unless `^[A-Za-z0-9._][A-Za-z0-9._/-]*$` and no `..`
  - `changedFiles(root: string, base: string, exec: Exec): readonly ChangedFile[]` — `git diff --name-status --no-renames -z <base>...HEAD --`, NUL-parsed
  - `blobAt(root: string, ref: string, repoPath: string, exec: Exec): string | null` — `git rev-parse --verify --quiet <ref>:<path>`; exit 1 means `null`, any other failure throws
  - `lastCommitTouching(root: string, ref: string, repoPath: string, exec: Exec): string | null` — `git log -n 1 --format=%H <ref> -- <path>`; empty output means `null`

- [ ] **Step 1: Write the failing tests** in `test/git.test.ts`, using `makeRepo` + `git()` from `test/helpers/repo.ts` and `realExec`; `git init -b main` first.
  - `changedFiles reports added, modified and deleted files`: on a branch, add `a.txt`, modify `b.txt`, delete `c.txt`; expect `[{A,a.txt},{M,b.txt},{D,c.txt}]` (sorted by path).
  - `changedFiles reports a rename as delete plus add`: `d.txt` → `e.txt` gives `{D,d.txt}` and `{A,e.txt}`.
  - `changedFiles ignores changes made only on the base after the branch point` (three-dot semantics).
  - `changedFiles returns a filename containing a newline intact`: file `we\nird.txt` appears as one entry with that exact path.
  - `assertRef rejects option-like and malformed refs`: throws for `--output=x`, `-x`, `a b`, `a..b`, `''`, `a@{1}`; returns `origin/main`, `HEAD` and a 40-hex SHA unchanged.
  - `changedFiles throws on an unsafe base` (`'--output=/tmp/x'`).
  - `blobAt returns the blob sha, null for a missing path, and throws for an unknown ref`.
  - `lastCommitTouching returns the newest commit that touched the path, null if none`: two commits touch `f`, a third doesn't; expect the second's sha.

- [ ] **Step 2: Run to verify failure.** Run: `npx vitest run test/git.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement** the four functions in `src/git.ts` with the signatures above. All four call `assertRef` on every ref they take; `repoPath` goes through `assertSafeRepoPath`. Parse `-z` output by splitting on `\0` and reading `status, path` pairs.

- [ ] **Step 4: Run to verify pass.** Run: `npx vitest run test/git.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/git.ts test/git.test.ts
git commit -m "feat: add git helpers for PR checks"
```

---

### Task 2: Classify a PR and enforce gate-PR scope

**Files:**
- Create: `src/classify.ts`, `test/classify.test.ts`

**Interfaces:**
- Consumes: `ChangedFile` (Task 1), `isChangeId` from `src/paths.ts`, `Gate`, `GATES` from `src/types.ts`.
- Produces:
  - `type PrKind = 'gate' | 'change' | 'other'`
  - `interface Classification { readonly kind: PrKind; readonly change: string | null; readonly gate: Gate | null; readonly problems: readonly string[] }`
  - `classifyPr(files: readonly ChangedFile[], headBranch: string): Classification`

Rules (D4, ADR 0001):
- A record path matches `^docs/changes/<id>/approvals/(spec|design|tests)\.json$` with `isChangeId(<id>)`. Only status `A`, `M` or `T` counts; `D` is ignored (D6).
- One or more matching records → `kind: 'gate'`. Problems: more than one record ("one gate per PR"); a record for a second change; any changed path (including deletions) not under `docs/changes/<id>/`; a head branch of the form `change/<other-id>` where `<other-id>` ≠ `<id>`.
- No record, and `headBranch` starts with `change/`: `kind: 'change'` with the id if `isChangeId` holds, otherwise `kind: 'other'` plus problem "branch change/… is not a valid change id".
- Anything else: `kind: 'other'`, no problems.

- [ ] **Step 1: Write the failing tests** in `test/classify.test.ts` (pure, no git):
  - `a lone approval record under its own change folder is a clean gate PR`: files `docs/changes/c1/approvals/tests.json (A)`, `docs/changes/c1/baseline.json (A)`, `docs/changes/c1/tests/stage/x.ts (A)`, branch `gate/c1-tests` → `{kind:'gate', change:'c1', gate:'tests', problems:[]}`.
  - `a gate PR that also edits vitest.config.ts is rejected` (the ADR 0001 attack): problems contain `vitest.config.ts is outside docs/changes/c1/`.
  - `a gate PR that edits another change's folder is rejected`.
  - `two records in one PR are rejected` (spec + design).
  - `records for two changes are rejected`.
  - `a deleted file outside the change folder is rejected in a gate PR`.
  - `a deleted record does not make a gate PR` → `kind:'other'`.
  - `branch change/c1 without records is an implementation PR` → `{kind:'change', change:'c1', gate:null}`.
  - `branch change/Bad_ID is other with a problem`.
  - `gate PR on branch change/c2 for change c1 is rejected`.
  - `an unrelated branch with no records is other`.
  - `a branch name with shell metacharacters is returned only as data`: branch `change/c1;rm -rf` → `kind:'other'`, problem present, nothing thrown.

- [ ] **Step 2: Run to verify failure.** Run: `npx vitest run test/classify.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement** `classifyPr` in `src/classify.ts` (freeze the result and `problems`).

- [ ] **Step 4: Run to verify pass.** Run: `npx vitest run test/classify.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/classify.ts test/classify.test.ts
git commit -m "feat: classify PRs and enforce gate-PR scope"
```

---

### Task 3: Read-only GitHub client over `gh api`

**Files:**
- Create: `src/github.ts`, `test/helpers/fake-gh.ts`, `test/github.test.ts`

**Interfaces:**
- Consumes: `Exec` from `src/exec.ts`.
- Produces (`src/github.ts`):
  - `interface PullSummary { readonly number: number; readonly mergedAt: string | null; readonly baseRef: string }`
  - `interface PullDetail { readonly number: number; readonly merged: boolean; readonly mergedBy: string | null; readonly author: string | null; readonly headSha: string }`
  - `interface Review { readonly user: string | null; readonly state: string; readonly commitId: string | null; readonly submittedAt: string | null }`
  - `interface GitHubReader { pullsForCommit(sha: string): readonly PullSummary[]; pull(n: number): PullDetail; reviews(n: number): readonly Review[] }`
  - `ghReader(repo: string, root: string, exec: Exec): GitHubReader` — runs `gh api -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28" <path>`; `repo` must match `^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`, `sha` `^[0-9a-f]{40}$`, `n` a positive integer, else throw before any call.
- Produces (`test/helpers/fake-gh.ts`):
  - `interface GhRoute { readonly path: string; readonly body: unknown }`
  - `withFakeGh(routes: readonly GhRoute[], real: Exec): Exec` — a `gh` call whose last argument equals a route's `path` returns `{status:0, stdout: JSON.stringify(body)}`; an unknown path returns `{status:1, stderr:'HTTP 404'}`; every other command goes to `real`. Records the `gh` paths it was asked for in an exported array `ghCalls` reset by `resetGhCalls()`.

API paths used: `repos/<repo>/commits/<sha>/pulls?per_page=100`, `repos/<repo>/pulls/<n>`, `repos/<repo>/pulls/<n>/reviews?per_page=100&page=<p>`.

Facts: *Verified 2026-10-18 against this repo:* `commits/{sha}/pulls` returns the PR for both the tip and a non-tip commit of a rebase-merged PR; the PR object carries `merged`, `merged_by.login`, `user.login`, `head.sha`, `base.ref`, `merged_at`. *Unverified against a live review (this repo has none):* review objects carry `user.login`, `state`, `commit_id`, `submitted_at` (field names from docs.github.com/rest/pulls/reviews, which does not list the `state` values). The code treats only the exact string `APPROVED` as an approval, so an unexpected value fails closed. Task 8 has a live check.

- [ ] **Step 1: Write the failing tests** in `test/github.test.ts` with `withFakeGh`:
  - `pullsForCommit maps the list response`: two items → `[{number, mergedAt, baseRef}]`; unmerged item has `mergedAt: null`.
  - `pull maps merged_by.login, user.login, head.sha` and maps a null `merged_by` to `null`.
  - `reviews pages until a short page`: first route returns 100 items, second 3 → 103 reviews, both paths requested.
  - `reviews fails closed after 10 full pages`: ten 100-item pages → throws `/too many reviews/`.
  - `a response of the wrong shape throws` (e.g. `merged` is a string, or `number` missing).
  - `a failed gh call throws and never echoes a token`: stderr `bad credentials ghp_abcdefghijklmnopqrstuvwxyz0123456789` → message contains `[redacted]`, not the token; also `github_pat_11AAAA_bbbb`.
  - `invalid repo, sha or number throws before calling gh` (`ghCalls` stays empty): repo `a/b/../c`, sha `HEAD`, number `0` and `1.5`.

- [ ] **Step 2: Run to verify failure.** Run: `npx vitest run test/github.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement** `ghReader` and `withFakeGh`. Parse each response with a small `expect*` shape guard (use `isObject` from `src/guards.ts`); redact with `/(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]+)/g`; cap error text at 300 characters.

- [ ] **Step 4: Run to verify pass.** Run: `npx vitest run test/github.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/github.ts test/helpers/fake-gh.ts test/github.test.ts
git commit -m "feat: add read-only GitHub client over gh api"
```

---

### Task 4: Provenance check

**Files:**
- Create: `src/provenance.ts`, `test/provenance.test.ts`

**Interfaces:**
- Consumes: `GitHubReader`, `Review`, `PullDetail` (Task 3); `blobAt`, `lastCommitTouching` (Task 1); `recordRepoPath` from `src/record.ts`; `Gate` from `src/types.ts`; `Exec`.
- Produces:
  - `approvedByApprover(reviews: readonly Review[], approvers: readonly string[], headSha: string): boolean` — per approver, take the latest review (by `submittedAt`, ties by list order) whose state is `APPROVED`, `CHANGES_REQUESTED` or `DISMISSED`; true if any approver's latest is `APPROVED` with `commitId === headSha`. Reviews by non-approvers are ignored entirely.
  - `interface ProvenanceInput { readonly id: string; readonly gates: readonly Gate[]; readonly base: string; readonly baseBranch: string; readonly approvers: readonly string[] }`
  - `provenanceProblems(root: string, input: ProvenanceInput, gh: GitHubReader, exec: Exec): string[]`

Per gate, with `path = recordRepoPath(id, gate)`:
1. `blobAt(base)` is `null` → `"<path> is not on <base>: its PR has not been merged"`.
2. `blobAt(base)` ≠ `blobAt('HEAD')` → `"<path> was changed in this PR; a record counts only after its own gate PR is merged"`.
3. `commit = lastCommitTouching(base, path)`; `gh.pullsForCommit(commit)` filtered to `mergedAt !== null && baseRef === baseBranch`. Zero → `"<path> was added by commit <short> with no merged PR into <baseBranch>"`. More than one → `"… by more than one PR (#a, #b)"`.
4. `detail = gh.pull(n)`; require `detail.merged`. `mergedBy` missing or not an approver → `"<path>: PR #n was merged by <login|nobody>, who is not an approver"`.
5. Per D1: if `detail.author` is an approver, accept. Else require `approvedByApprover(gh.reviews(n), approvers, detail.headSha)`, otherwise `"<path>: PR #n has no approving review from an approver on its final commit"`.
Any exception from git or `gh` for a gate becomes one problem `"<path>: <message>"`.

- [ ] **Step 1: Write the failing tests** in `test/provenance.test.ts`. Real git repo (`main` with a commit adding `docs/changes/c1/approvals/spec.json`; then a branch commit) plus a hand-written `GitHubReader` stub keyed by the commit sha.
  - `approvedByApprover` table: approval on head by approver → true; approval on an older commit → false; approval then `CHANGES_REQUESTED` by the same approver → false; `CHANGES_REQUESTED` then `APPROVED` → true; `APPROVED` then `DISMISSED` → false; approval by a non-approver → false; login `Tassi` vs approver `tassi` → true; a later `COMMENTED` by the approver doesn't cancel an earlier `APPROVED`; empty list → false.
  - `a record merged by an approver on a bot-authored PR with an approving review passes`.
  - `a record merged by the human author with no review passes` (D1).
  - `a record whose PR was merged by the bot is rejected` (`mergedBy: 'agent-bot'`): message contains `agent-bot` and `not an approver`.
  - `a bot-authored PR merged by an approver with no review is rejected`.
  - `a record whose commit has no PR is rejected`; `an unmerged PR is rejected`; `a PR merged into another branch is rejected`; `two merged PRs for the commit are rejected`.
  - `a record missing on the base is rejected`; `a record changed in this PR is rejected`.
  - `a gh failure becomes a problem, not a throw` (stub throws `Error('HTTP 502')`).
  - `all gates are reported, not just the first` (spec and design both bad → two problems).

- [ ] **Step 2: Run to verify failure.** Run: `npx vitest run test/provenance.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement** both functions in `src/provenance.ts`. Compare logins with `toLowerCase()`.

- [ ] **Step 4: Run to verify pass.** Run: `npx vitest run test/provenance.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/provenance.ts test/provenance.test.ts
git commit -m "feat: check approval records were merged by an approver"
```

---

### Task 5: `pr-check`, `classify` and the CLI wiring

**Files:**
- Create: `src/pr-check.ts`, `test/pr-check.test.ts`
- Modify: `src/cli.ts` (USAGE, `ARITY`, options, `dispatch`); `test/cli.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4, `loadConfig`, `checkGate`, `checkAll`, `GATES`, `PREREQS`.
- Produces:
  - `interface PrCheckInput { readonly base: string; readonly baseBranch: string; readonly headBranch: string; readonly repo: string }`
  - `classifyDiff(root: string, base: string, headBranch: string, exec: Exec): Classification` — `changedFiles` + `classifyPr`
  - `prCheck(root: string, input: PrCheckInput, exec: Exec, gh?: GitHubReader): Classification` — adds, to the classification's problems:
    - `gate` PR: `checkGate(root, id, gate)` must be `valid` (problem lines `"<gate> gate is <status>: <problem>"`), and `provenanceProblems` for `PREREQS[gate]`;
    - `change` PR: `checkAll` all `valid`, and `provenanceProblems` for all of `GATES`;
    - `other`: nothing.
    Returns early (without calling GitHub) when classification already has problems. `gh` defaults to `ghReader(input.repo, root, exec)`.
- CLI:
  - `wf classify --base <ref> --branch <name>` prints only `kind=<kind>`, then `change=<id>` and `gate=<gate>` when set, one per line on stdout (GITHUB_OUTPUT format). Problems go to stderr as `- <problem>`, so redirecting stdout into `$GITHUB_OUTPUT` never writes an invalid line. Exit 1 if any problem.
  - `wf pr-check --base <ref> --base-branch <name> --branch <name> --repo <owner/name>` prints the same, exit 0/1.
  - A flag used with a command that doesn't take it exits 2. `--report` stays `trace-check` only. Missing required flag exits 2 with a message naming it.

- [ ] **Step 1: Write the failing tests** in `test/pr-check.test.ts`. Build a repo with `makeRepo`/`git`/`changeFiles`/`approveAll` helpers (`test/helpers/change.ts`): `main` holds `workflow.config.json` (approvers `['tassi']`) and an approved spec and design; branches add the next stage. Use `withFakeGh` routes for PR #7 (spec record) and #8 (design record).
  - `a correct implementation PR passes`: branch `change/c1` with the tests record merged earlier; routes say PRs merged by `tassi`; exit problems `[]`, `kind:'change'`.
  - `an implementation PR whose design record was merged by the bot is rejected` (bot-merged approval record).
  - `an implementation PR that edits a covered design file is rejected` (gate-check reports `changed`).
  - `an implementation PR that rewrites a record is rejected` ("changed in this PR").
  - `a tests gate PR that also edits vitest.config.ts is rejected before any GitHub call` (ADR 0001 attack; `ghCalls` empty).
  - `a clean tests gate PR passes` with spec and design provenance from routes; its own record is `valid`.
  - `a tests gate PR whose design record isn't on main is rejected`.
  - `a gate PR whose record doesn't match its files is rejected` (record hash stale).
  - `an other PR passes without touching GitHub`.
  - In `test/cli.test.ts`: `classify prints only key=value lines on stdout and problems on stderr`, `classify exits 2 without --branch`, `--base with an option-like value exits 2`, `--repo on spec-lint exits 2`, `pr-check exits 1 and prints problems`.

- [ ] **Step 2: Run to verify failure.** Run: `npx vitest run test/pr-check.test.ts test/cli.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement** `src/pr-check.ts`, then add the commands to `src/cli.ts` (`Io.exec` already exists; default to `realExec` when absent). Update `USAGE` and `ARITY` (`classify: 0`, `pr-check: 0`, `run-tests: 0`).

- [ ] **Step 4: Run to verify pass.** Run: `npx vitest run` — Expected: all PASS.

- [ ] **Step 5: Commit**
```bash
git add src/pr-check.ts src/cli.ts test/pr-check.test.ts test/cli.test.ts
git commit -m "feat: add classify and pr-check commands"
```

---

### Task 6: `run-tests`

**Files:**
- Create: `src/run-tests.ts`, `test/run-tests.test.ts`
- Modify: `src/cli.ts`

**Interfaces:**
- Consumes: `loadConfig`, `Exec`, `repoPath` helpers from `src/safe-fs.ts` (`readRepoFile`, `writeRepoFile`).
- Produces: `runTests(root: string, exec: Exec, reportOut?: string): { status: number; output: string }` — runs `test.setup` (if any) then `test.command` with `exec(cmd, args, root)`; stops at the first non-zero status and returns it; with `reportOut`, after a zero status copies `test.junitReport` to that repo path (error if the report is missing). `output` is the concatenated stdout and stderr.
- CLI: `wf run-tests [--report-out <repo path>]` prints `output`, exits with `status` (clamped to 1 for any non-zero) or 2 on input errors.

- [ ] **Step 1: Write the failing tests** with a fake `Exec`:
  - `runs setup then command in order and returns 0`.
  - `stops at a failing setup and does not run the command` (status 1).
  - `returns 1 when the command fails`.
  - `copies the report to --report-out after success` (fake exec writes the file).
  - `fails when the report is missing after a successful run`.
  - `rejects an unsafe --report-out` (`../x`).
  - CLI: `run-tests --report-out` is accepted; `--report-out` on another command exits 2.

- [ ] **Step 2: Run to verify failure.** Run: `npx vitest run test/run-tests.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement** `runTests` and the CLI case.

- [ ] **Step 4: Run to verify pass.** Run: `npx vitest run` — Expected: all PASS.

- [ ] **Step 5: Commit**
```bash
git add src/run-tests.ts src/cli.ts test/run-tests.test.ts
git commit -m "feat: add run-tests command for CI"
```

---

### Task 7: CI template, CODEOWNERS and ruleset

> Superseded in part: the nested `.wf-trusted/` layout below became sibling `pr/` + `trusted/` (Task 7 fix round 1), and a `branches:` filter was added to `on.pull_request` after the final review. The shipped `templates/ci/wf.yml` and its tests are the source of truth.

**Files:**
- Create: `templates/ci/wf.yml`, `templates/CODEOWNERS`, `templates/ruleset.json`, `test/templates.test.ts`
- Modify: `package.json`, `package-lock.json` (`npm install -D --save-exact yaml@2.9.1`)

**Interfaces:** none consumed or produced by other tasks.

Design of `templates/ci/wf.yml` (D2, D3):
- Trigger: `on: pull_request` only. Top-level `permissions: { contents: read }`.
- `env: WF: node .wf-trusted/.workflow/wf/bin.js` (the installer, Plan 3, owns the real path).
- Every job: `runs-on: ubuntu-latest`; checkout PR (`fetch-depth: 0`, `persist-credentials: false`); checkout `${{ github.event.pull_request.base.sha }}` into `.wf-trusted` (`persist-credentials: false`); `setup-node` 24. Untrusted values enter only through the job `env:` block (`HEAD_REF`, `BASE_REF`, `BASE_SHA`, `REPO`) and are quoted in scripts.
- `gate-check`: `permissions: { contents: read, pull-requests: read }`, `env: GH_TOKEN: ${{ github.token }}`; run `$WF pr-check --base "$BASE_SHA" --base-branch "$BASE_REF" --branch "$HEAD_REF" --repo "$REPO"`.
- `memory-check`: run `$WF memory-check`.
- `stage-check`, `verify`, `trace-check` each start with a step `id: classify` running `$WF classify --base "$BASE_SHA" --branch "$HEAD_REF" >> "$GITHUB_OUTPUT"`. A failing `classify` exits 1 and fails the job, which is the intended result for a malformed PR.
- `stage-check`: step `if: steps.classify.outputs.kind == 'change'` runs `$WF stage-check "$CHANGE"` with `CHANGE: ${{ steps.classify.outputs.change }}` in `env:`.
- `verify`: `needs: stage-check`; always runs `$WF run-tests --report-out .wf-report/junit.xml`; uploads `.wf-report/junit.xml` as artifact `junit-report` (`if: always()` is **not** used, so a failed test run uploads nothing).
- `trace-check`: `needs: verify`; step `if: kind == 'change'` downloads `junit-report` to `.wf-report/` and runs `$WF trace-check "$CHANGE" --report .wf-report/junit.xml`.
- Action `uses:` pinned to full 40-hex commit SHAs with a trailing `# vX.Y.Z` comment. Resolve with `gh api repos/actions/checkout/git/ref/tags/<tag> --jq .object.sha` (and the same for `setup-node`, `upload-artifact`, `download-artifact`; dereference annotated tags via `git/tags/<sha>`). Use the newest release that is at least two weeks old.

`templates/CODEOWNERS` (file ships as `.github/CODEOWNERS`; `@APPROVER` is replaced by the installer): one line per protected path from the spec's *Trust boundary* list — `/tests/acceptance/`, `/tests/harness/`, `/vitest.config.*`, `/.workflow/`, `/.github/`, `/workflow.config.json`, `/AGENTS.md`, `/roles/`, `/docs/specs/`, `/docs/decisions/`, `/docs/changes/*/approvals/`, `/docs/changes/*/baseline.json`, `/docs/changes/*/design/`, `/docs/changes/*/tests/` (D5) — each owned by `@APPROVER`. Runner config files other than vitest are added by the installer from `test.harness`.

`templates/ruleset.json` (body for `gh api -X POST repos/{owner}/{repo}/rulesets --input`): `name: "protect-main"`, `target: "branch"`, `enforcement: "active"`, `bypass_actors: []`, `conditions.ref_name.include: ["~DEFAULT_BRANCH"]`; rules `deletion`, `non_fast_forward`, `required_linear_history`, `pull_request` (`allowed_merge_methods: ["rebase"]`, `required_approving_review_count: 1`, `require_code_owner_review: true`, `dismiss_stale_reviews_on_push: true`, `require_last_push_approval: true`, `required_review_thread_resolution: true`), and `required_status_checks` with contexts `gate-check`, `stage-check`, `verify`, `trace-check`, `memory-check` (each `integration_id: 15368`, *verified 2026-10-18* from this repo's `protect-main`) and `strict_required_status_checks_policy: true`.

- [ ] **Step 1: Write the failing tests** in `test/templates.test.ts` (read the files, parse with `yaml`/`JSON.parse`):
  - `workflow triggers only on pull_request` (no `pull_request_target`, no `push`).
  - `workflow token is read-only by default` and only `gate-check` has `pull-requests: read`.
  - `workflow defines exactly the five required jobs`.
  - `every uses: is pinned to a 40-hex SHA`.
  - `no run: script interpolates a github or steps expression` (regex `\$\{\{` absent from every `run:` value).
  - `every checkout sets persist-credentials: false`.
  - `wf is invoked from .wf-trusted, never from the workspace root`.
  - `verify needs stage-check and trace-check needs verify`.
  - `CODEOWNERS names every protected path` (a literal list in the test mirroring the spec) `and every line is owned by @APPROVER`.
  - `ruleset requires code-owner review, an approving review, linear history, rebase only and the five checks`.

- [ ] **Step 2: Run to verify failure.** Run: `npx vitest run test/templates.test.ts` — Expected: FAIL (files missing).

- [ ] **Step 3: Create the three templates** as specified above and pin the action SHAs.

- [ ] **Step 4: Run to verify pass.** Run: `npx vitest run test/templates.test.ts` — Expected: PASS. Also run `npm run typecheck && npm run coverage` — Expected: PASS, coverage ≥ 80%.

- [ ] **Step 5: Commit**
```bash
git add templates test/templates.test.ts package.json package-lock.json
git commit -m "feat: add CI, CODEOWNERS and ruleset templates"
```

---

### Task 8: Setup guide, live verification and docs sync

**Files:**
- Create: `docs/guides/github-setup.md`
- Modify: `docs/specs/2026-09-29-agentic-workflow-design.md` (v2.7), `AGENTS.md` (Status), `docs/decisions/0001-acceptance-dir-and-manifest.md` (Follow-up)

**Interfaces:** none.

- [ ] **Step 1: Verify the bot token permissions.** Fetch GitHub's "Permissions required for fine-grained personal access tokens" docs; record the exact permission names for: push a branch, open a PR, comment, and the ones that must be absent (workflows, administration, actions, secrets). Mark each as verified with the source URL and date, or unverified.

- [ ] **Step 2: Write `docs/guides/github-setup.md`** with these sections, each fact marked verified/unverified:
  1. Requirements: public repo, or GitHub Pro for rulesets (*verified 2026-10-07*).
  2. Bot identity: a separate GitHub account with a fine-grained token limited to the permissions from Step 1; invite it as a collaborator with write access; why `GITHUB_TOKEN`-made pushes don't trigger workflows and a token does (check and cite).
  3. Install: copy `templates/CODEOWNERS` to `.github/CODEOWNERS` (replace `@APPROVER`), `templates/ci/wf.yml` to `.github/workflows/wf.yml`, create the ruleset with `gh api -X POST repos/OWNER/REPO/rulesets --input templates/ruleset.json`.
  4. Bootstrap: the install PR cannot be judged by a base that lacks `.workflow/`; merge it before adding the five checks to the ruleset.
  5. What provenance guarantees and doesn't: D1, D3, D4, D6 in plain words; "if agents hold your own token, provenance proves nothing".
  6. Solo-without-bot variant: `required_approving_review_count: 0`, same checks, weaker guarantee.
  7. **Live verification (needs the bot account):** in a scratch repo, bot opens a PR adding a fake record, you approve and merge, then run `wf pr-check` on a follow-up branch with a real `GH_TOKEN`; then repeat with the bot's own merge refused by the ruleset. Record the result and the observed review `state` values.

- [ ] **Step 3: Run the live verification** from section 7 with the user (needs their bot account; ask the user before creating any repo or account). If it can't be run now, leave the guide's checklist unticked and say so in the status line below.

- [ ] **Step 4: Sync docs.** Design doc → v2.7: add the *Implementation conventions* entries for `classify`, `pr-check`, `run-tests`, D1–D6, the CI job chain, the verified API facts, and replace the *Unverified: the exact GitHub API fields* note. `AGENTS.md` Status: Plan 2a done (or done pending the live check), Plan 2b next. ADR 0001 *Follow-up*: gate-branch fix done by Plan 2a.

- [ ] **Step 5: Verify and commit.** Run: `npm run typecheck && npm run coverage && npm run build && node dist/bin.js --help` — Expected: all succeed, `--help` lists `classify`, `pr-check`, `run-tests`.
```bash
git add docs AGENTS.md
git commit -m "docs: add GitHub setup guide, design v2.7"
```

---

## Self-review
- **Spec coverage:** provenance (Task 4, 5), CI template with five checks (Task 7), CODEOWNERS and protected paths (Task 7), bot identity and ruleset guide (Task 7, 8), tests-gate PR scope (Task 2, 5), "Unverified: GitHub API fields" resolved (Task 3, 8).
- **Spec gaps made explicit:** archive flow (D6), P0 lane (D4), conditional protection of staging (D5), solo-author approval (D1).
- **Type consistency:** `ChangedFile` (T1) → `classifyPr` (T2) → `classifyDiff`/`prCheck` (T5). `GitHubReader`/`Review` (T3) → `approvedByApprover`/`provenanceProblems` (T4) → `prCheck` (T5). `Classification` is defined once in T2.
- **Proportion:** about 3× the spec section it implements; code appears only as signatures, test names and rules.
