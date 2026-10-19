# Agentic Workflow — Design v2.8

Supersedes `2026-09-26-agentic-framework-design.md`. v2.1 added: the agent team model, a reordered lifecycle (contract before tests), the planning dial, test-dispute and harness ownership, and memory maturity, plus ideas from claudex-loop and OpenRig. v2.2 (from Codex reviews 3–4): approvals are hash-bound to you and **chained** (design → spec, tests → spec + design), and tests are **staged and locked by hash** with an approved baseline instead of merged early. That removes the row-state machine. v2.3 (2026-10-06): automated PR review is Codex cloud review, AI approvals never count, review instructions are protected, and Copilot is rejected for now (see *Automated PR review*). v2.4 (2026-10-07, ADR 0001, from dogfood run 1): rows count only from tests under `test.acceptanceDir`, and the baseline locks the whole acceptance folder plus the runner config, so a runner-config filter plus decoy tests no longer passes (see *Test staging, baseline and activation*). v2.5 (2026-10-07, ADR 0002): green CI is proof against reward hacking (T1) but only evidence against code built to defeat the measurement (T2); T2 is detected by a must-fail canary and an isolated CI test run (Plan 2), and prevented in projects that opt into black-box acceptance tests (see *Trust boundary*). v2.6 (2026-10-17, Spike S): builders run **one at a time** on one branch per change; parallel builders in separate worktrees are deferred until Spike S2 proves them safe (see *Workspaces*). v2.7 (2026-10-19, Plan 2a): provenance is implemented as `wf pr-check` (approvers read from the base commit; a record PR an approver authored and merged needs no review), PR kind comes from the diff, CI runs `wf` from a checkout of the base commit in five required jobs, and a solo approver needs the bot to author PRs (see *Gates and approval records*, *Trust boundary*, *Implementation conventions*; setup in `docs/guides/github-setup.md`). v2.8 (2026-10-20, Codex review of Plan 2a): PR classification is **default-deny**. A PR that is not a gate PR and not on a `change/<id>` branch passes only if every changed path is in the base config's `exempt` list and outside a fixed never-exempt floor; otherwise it fails (D7 to D10, see *Implementation conventions*). The branch name can no longer grant a pass.

## Context
The product is the **workflow**: how memory, decisions, specs, tests and a team of agents fit together. It gets installed into any TypeScript repo, greenfield or brownfield, with `npx <tool> init`.
The human writes specs and scenarios, approves at the gates, and merges. An **orchestrator** coordinates a team of role agents. **Codex** writes the acceptance tests and reviews. Builders never grade their own work.

## Principles
1. **The repo is the memory.** Markdown, versioned, readable by any agent. Agent runtimes (team configs, mailboxes) are temporary and never the record.
2. **Messages coordinate; files decide.** A message that changes a decision must change a file (spec delta, ADR, contract).
3. **The implementer never grades its own homework.** Enforcement sits out of the implementer's reach: protected CI and a low-privilege bot identity.
4. **Human gates are never delegated.** No agent, the orchestrator included, can approve a spec, contract or PR.
5. **Progressive disclosure.** A small index is always loaded; everything else is read on demand.
6. **Updating memory is a gate. Everything is a change.**

## Installed layout
```
AGENTS.md                          canonical rules: a managed block (replaced on upgrade) + a project section
CLAUDE.md                          "@AGENTS.md" + Claude-only notes
roles/<role>.md                    PROJECT-OWNED role definitions (source of truth) → generated into
.claude/agents/<role>.md           ...the Claude agent definitions (generated, don't edit)
.workflow/                         MANAGED: version, templates/, scripts/ (verify, trace-check, memory-check,
                                   spec-lint, gen-roles), hooks/, ci/, runner/ (cross-provider call)
workflow.config.json               project-owned: commands, protected paths, model tiers
docs/
  context.md                       ALWAYS LOADED index (≤150 lines); one per package in monorepos (same name)
  glossary.md                      domain terms, one definition each, banned synonyms on a "Not:" line
  specs/<capability>/spec.md       living spec: rule tables + journeys + UI states, stable row IDs
  changes/<id>-<slug>/             proposal.md, spec-delta.md, tasks.md, decisions-audit.md,
                                   design/ (design.md, mockups, adr drafts, stage/ mirroring live paths),
                                   tests/stage/ (staged acceptance tests + harness, mirroring live paths), retires.json, change.json,
                                   baseline.json, approvals/<gate>.json
  changes/archive/
  decisions/NNNN-<title>.md        ADRs (number assigned at merge)
  lessons.md                       entries carry stage + warrant (see Memory)
  progress/<branch>.md             handoff log; every item closes with a reason
tests/acceptance/<capability>/     written by Codex, LOCKED; test names carry row IDs
tests/harness/                     fixtures, seeds, helpers, runner configs: LOCKED, owned by QA
```

## Team model

### Roster (example; roles are data and can be added or removed)
| Role | Lifetime | Provider / model tier | Owns (write access) | Job |
|---|---|---|---|---|
| orchestrator | session (team lead) | Claude, top | `docs/changes/<id>/tasks.md`, `progress/` | Plans the change, spawns roles, owns the task list, **sole contact with you**, never writes product code |
| db-designer | design stage only | Claude, top | `db/migrations/**` (draft), `design.md#schema` | Schema and migration proposal, ADR drafts |
| ui-ux-designer | design stage only | Claude, top | `design/**`, `design.md#ui` | UI states and mockups; adds UI-state rows to the delta |
| backend-dev | per change | Claude, mid | `apps/api/**`, `packages/contracts/**` (impl only) | Builds against the approved contract, TDD |
| frontend-dev | per change | Claude, mid | `apps/web/**` | Builds against the approved contract, TDD |
| qa | per change | Claude wrapper → **Codex CLI** | `docs/changes/<id>/tests/**` (tests gate PR only) | Turns rows into acceptance tests and holdout cases; rules on test disputes |
| integrator | per change | Claude, mid | none (read-only) | Runs `verify --full` on the change branch and opens the PR (builders work in sequence, so there's nothing to merge) |
| reviewer | per PR | **Codex CLI**, fresh session | none (read-only) | Adversarial review; classifies each miss as CONTEXT-GAP or JUDGMENT-GAP |

- **Role file** (`roles/<role>.md` frontmatter): `provider`, `model_tier`, `lifetime`, `owned_paths`, `may_message`, `inputs`, `outputs`, then the instructions in the body. `gen-roles` renders these into `.claude/agents/` and the Codex prompt templates, so each role is defined in one place.
- **Runtime (v1):** Claude Code agent teams (experimental, enabled with `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`) for the Claude roles. Codex roles are called through the cross-provider runner: one CLI turn, schema-validated verdict, result tied to the hash of what was judged, fresh session for inspection.

### Communication rules
- Peers may message each other directly (SendMessage). **Any agreed decision → a file change in the same step.**
- Before archiving a change, the orchestrator writes `decisions-audit.md`: each decision made in messages, mapped to the file that records it. memory-check fails if the file is missing.
- Questions for you go through the orchestrator, **batched**, one decision per question, with its recommendation.
- If two roles disagree for more than 2 rounds → orchestrator → you → an ADR or a lesson.

### Enforcement (local hooks give early feedback; CI is the guarantee)
- **PreToolUse hook:** a role can't write outside its `owned_paths`.
- **TaskCompleted hook:** blocks marking a task done unless `verify --fast` passes for that role's paths.
- **TeammateIdle hook:** an idle builder with an open task gets nudged to continue or block with a reason.
- **Gates are approval records on main** (see *Gates and approval records*), never stamps an agent can write. The team's own plan approval (which the lead grants automatically) means nothing.

### Automated PR review (decided 2026-10-06)
Two review paths, both advisory:
- **reviewer role** (above): Codex CLI through the runner, adversarial, on implementation PRs; its verdict is tied to the hash of what it judged.
- **Codex cloud review** on every PR, on GitHub's side, so an agent can't skip it. Triggered automatically (Codex settings → Automatic review) or by commenting `@codex review`. It follows a `## Code Review Rules` section in `AGENTS.md`. *Verified 2026-10-06 against learn.chatgpt.com/docs/third-party/github. Unverified: which ChatGPT plans include it.*

Rules:
- **AI reviews never approve.** No AI review (Codex, Copilot or any other) counts toward required approvals or any gate. You are the only approval. GitHub's option to let Copilot approvals count toward merge requirements stays off.
- **Review instructions are protected.** Reviewers read their instructions from the PR's own branch, so an agent could weaken the rules inside the PR being reviewed. `AGENTS.md` and reviewer instruction files are protected paths (see *Trust boundary*).
- **Deterministic analysis runs in CI as hard gates** (CodeQL code scanning, ESLint), not inside AI review comments.

**Copilot code review: rejected for now.** Reasons:
- It adds no model diversity beyond Claude plus Codex. GitHub doesn't name the model behind it and you can't choose one (checked against the 2025-10-28 changelog).
- Its real gains (runs on GitHub, gathers project context, inline comments) are already available through Codex cloud review.
- It's a third subscription (Copilot Pro or higher).

Revisit if its announced CodeQL/ESLint integration ships and getting those results inside the review proves more useful than running them as separate CI checks.

**Measure in Trial 1:** for each reviewer, count findings no other reviewer caught, comments that were noise, and minutes you spent triaging. Drop any reviewer that rarely finds something new.

### Workspaces (decided 2026-10-17, Spike S)
**Builders run one at a time on one branch per change** (`change/<id>`), checked out in the normal repo folder; no worktrees. backend-dev builds and commits, then frontend-dev builds on top of that commit. Owned paths still apply per role. Read-only roles (orchestrator, reviewer) may run alongside a builder. The integrator has no merge to do; it runs `verify --full` and opens the PR.

Why: Spike S (`docs/research/2026-10-17-spike-s.md`) showed that `EnterWorktree` from an in-process teammate re-scopes the **whole session**, lead and every teammate, to that worktree. So builders can't each enter their own. Hand-made worktrees work but need explicit `cd` in every command and a teammate→worktree registry for hooks. Running one builder at a time needs neither, and uses only behaviour the spike verified. The cost is speed: a backend + frontend change takes the sum of both builds, not the longer of the two.

**Parallel builders are deferred**, not dropped. Spike S2 tests split-pane teammates (each its own process, so a worktree might stay local to it). If that works, parallel builders return as an opt-in for large changes, with a teammate→worktree registry for hooks.

**Hook requirements from Spike S** (apply either way):
- The installer sets `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`. On current models the task tools are off by default, and without them the TaskCreated and TaskCompleted gates never fire.
- A blocking TaskCompleted hook needs a **loop guard**. It also fires when a teammate goes idle holding an open task, so a refusal wakes the teammate, which idles again (24 cycles in the spike). Refuse at most 3 times per task, then report to the orchestrator and stop blocking.
- Hooks identify the agent by `teammate_name`/`agent_type` from the payload, never by `cwd`, which is the session's directory and is shared.

## Planning dial (replaces fixed lanes)
| Level | When | What runs |
|---|---|---|
| P0 | trivial, reversible (typo, copy, dependency patch) | single builder, no team, no spec; `verify --full` must pass and no contract may change |
| P1 | default | full lifecycle |
| P2 | spec would freeze on an external unknown | + research round before CLARIFY ends |
| P3 | failure would be **invisible to its author** (auth, money, migrations, concurrency) | + adversarial plan review by Codex, mandatory ADR, staged rollout |
| P4 | design highly uncertain | + a blind design by a second agent, compared with the first |
The test for going up a level is "would a wrong plan be expensive, hard to undo and invisible from inside", not "is this important". The orchestrator proposes a level; you confirm it.

## Change lifecycle (P1)
```
0 MAP        brownfield: an explorer drafts current-behaviour rows + characterization tests → you confirm, marking bugs
1 PROPOSE    you: proposal.md + spec-delta.md (rule tables, journeys, UI states)
2 CLARIFY    orchestrator: gap hunt + spec-lint (conflicting rows, missing failure/authz/limit rows) → your answers
             → SPEC GATE PR (spec-delta + approvals/spec.json) → you approve and merge
3 DESIGN     db-designer + ui-ux-designer + backend-dev draft into docs/changes/<id>/design/ (staged files under design/stage/ mirror live paths): contract,
             migration draft, mockups, ADRs, task split with owned paths → (P3+: Codex adversarial review)
             → DESIGN GATE PR (design/ + approvals/design.json) → you approve and merge
             (drafts live under docs/changes/, so nothing deployable reaches main before implementation)
4 TESTS      qa/Codex: approved rows + contract → acceptance tests + holdout cases, STAGED in docs/changes/<id>/tests/
             → CI runs them against current main and writes baseline.json (per row: fails = new behaviour,
               passes = already-existing behaviour)
             → TESTS GATE PR (staged tests + baseline + approvals/tests.json) → you review tests AND baseline, merge
             staged tests are not live: nothing about main's test suite changes yet
5 BUILD      backend-dev → frontend-dev, one at a time on the change branch, TDD against the staged tests (`wf promote <id> tests`);
             Stop/TaskCompleted hooks run verify --fast
             TaskCreated hook refuses build tasks until `wf gate check <id> tests` passes on main (which implies spec + design)
             stuck 3× → Codex rescue → orchestrator → you
             locked test looks wrong → TEST DISPUTE (written reasoning) → qa amends → new TESTS GATE PR (re-approval)
             intent rests on a missing capability → mark PARTIAL, name the gap, create a follow-on change
6 INTEGRATE  integrator runs verify --full on the change branch (no merge: builders worked in sequence)
7 PR         IMPLEMENTATION PR = code + staged tests/contract/migration copied into live locations
             + deletion of any rows this change retires.
             CI: all gates valid (chained), live tests/harness/contract/migration byte-identical to approved staging,
             every row of this change executes and passes, verify --full, trace-check, memory-check, holdout run
8 REVIEW     Codex reviewer (fresh) → you merge: code, its tests and any retirements land in ONE merge → archive;
             delta folded into the living spec; decisions audited
```
The contract is fixed at stage 3, before any tests (stage 4) or builds (stage 5). That's what makes splitting builders by layer workable, in sequence now and in parallel later.

## Gates and approval records
A gate counts only if **you** approved **these exact bytes**. Both halves are checked mechanically.

**The record.** `docs/changes/<id>/approvals/<gate>.json`, generated by `wf approve <id> <gate>` from the files on disk:
```json
{ "change": "<id>", "gate": "design", "tool_version": "x.y.z",
  "requires": [ { "gate": "spec", "record_sha256": "…" } ],
  "covered": [ { "path": "docs/changes/<id>/design/stage/packages/contracts/openapi.yaml", "sha256": "…" },
               { "path": "docs/changes/<id>/design/migration.sql",     "sha256": "…" } ] }
```
| Gate | Covers | Bound to (`requires`) |
|---|---|---|
| `spec` | `proposal.md`, `spec-delta.md` | nothing |
| `design` | everything under `docs/changes/<id>/design/` (staged contract and migration under `stage/`, mockups, `design.md`, task split) + the change's draft ADRs | `spec` record |
| `tests` | everything under `docs/changes/<id>/tests/` (staged tests + harness overlay) + `baseline.json` + the list of rows this change retires | `spec` and `design` records |

**Authentication (who).**
- The record has no "approved_by" field an agent could forge. A record is valid only if it **reached main through a PR approved and merged by an account listed in `workflow.config.json → approvers`**.
- CI checks that with `wf pr-check` (the `gate-check` job). For each record the PR relies on: the record is on the base commit and unchanged in the PR; the last base commit that touched it belongs to exactly one PR merged into the base branch; `merged_by` is an approver; and either the PR's author is an approver, or an approver's latest deciding review (`APPROVED`, `CHANGES_REQUESTED`, `DISMISSED`) is `APPROVED` on the PR's final head commit (D1). Logins compare case-insensitively. Any git or GitHub error, unexpected response or ambiguity fails closed; so does a shallow checkout.
- **Approvers come from `workflow.config.json` at the base commit**, never the PR head, so a PR can't add itself or the bot to the list. A design, tests or implementation PR whose base has no usable config fails.
- **D1, self-authored records.** GitHub doesn't let an author approve their own PR, so a record PR opened and merged by an approver passes with no review. That branch is only as strong as the separation between you and the bot token: if agents use your token, provenance proves nothing.
- `docs/changes/*/approvals/**` is a protected path (CODEOWNERS = you). The bot identity can open the PR but can't approve it. It can merge it once you've approved (merging needs only Contents write); provenance then rejects the record because `merged_by` is not an approver.
- *Verified 2026-10-18 against this repo:* `GET /repos/{r}/commits/{sha}/pulls` returns the PR for both the tip and a non-tip commit of a rebase-merged PR; the PR object carries `merged`, `merged_by.login`, `user.login`, `head.sha`, `base.ref`, `merged_at`. *Verified 2026-10-19 (docs.github.com/en/rest/pulls/reviews):* review objects document `user.login`, `state`, `commit_id`, `submitted_at`; the review `event` values are `APPROVE`, `REQUEST_CHANGES`, `COMMENT`. *Unverified:* the `state` values a live review returns (the docs don't list them). The code accepts only the exact string `APPROVED`, so an unexpected value fails closed. The live check is in the setup guide, section 7.

**Integrity and invalidation (what).**
- On every PR, `gate-check` recomputes the sha256 of every covered path. Any mismatch, or a missing covered file, makes that gate **invalid**.
- **Chained binding.** A gate is valid only if:
  1. its own covered hashes match;
  2. the sha256 of each prerequisite record **equals the `record_sha256` it was approved against**; and
  3. each prerequisite is itself valid.

  So re-approving the spec changes the spec record's hash, which **transitively invalidates** design and tests, even if their own files didn't change. Downstream approvals can never silently carry over to an upstream revision.
- Every stage that depends on an invalid gate is blocked: a tests gate PR needs `spec` + `design`; an implementation PR needs all three.
- The only way back is a new gate PR with a fresh record. A downstream re-approval can be quick (`wf approve` regenerates it from unchanged files), but it's still your explicit confirmation that the downstream artifacts fit the new upstream revision.
- The implementation PR copies the approved staging into live locations (`packages/contracts/openapi.yaml`, `db/migrations/NNN_*.sql`, `tests/acceptance/<capability>/**`, `tests/harness/**`). CI requires the live files to be **byte-identical** to the approved staging, so implementation can't silently change the contract, schema or tests.
- Approving a later revision replaces the record. Git history keeps the old one.

**Local early check.** Hooks call `wf gate check <id> <gate>` so a builder doesn't start against a stale design. CI remains the guarantee.

## Test staging, baseline and activation
**Approved tests are locked by hash, not by sitting on main.** Main's live suite only ever holds tests whose code has shipped, so it only ever has passing tests. There are no row states, no expected-fail on main, and no expiry.

**1. Staging.** qa writes the tests (plus any harness changes, as an overlay) under `docs/changes/<id>/tests/`. The runner config only discovers `tests/acceptance/**`, and that config is itself a locked harness file, so staged tests never run as part of main's suite. Builders run them locally after `wf promote <id> tests` in their worktree.

**2. Baseline.** On the tests gate PR, CI runs the staged tests (with the harness overlay) against current main and writes `baseline.json`: `{ rowId: "fails" | "passes" }`, plus a manifest (path, sha256 and, for acceptance files, the row tags they contain) of every file under `test.acceptanceDir` and every `test.harness` path on main. You approve the tests, the baseline **and** the manifest together. The baseline handles legitimate already-passing rows:
- `passes`: the behaviour already exists (unchanged rules, unauthenticated → 401, brownfield characterization rows). That's fine and recorded.
- `fails`: new or changed behaviour, which the implementation must produce.
- **At least one row must be `fails`**, or the change declares `no-behaviour-change` (a refactor), which sends it to the P0 lane. This is the targeted evidence that the change actually does something and its tests can detect it.
- A row that passes but that the spec delta says is **new** behaviour is flagged for you. Either the test is too weak or the behaviour already exists; you decide before approving.

**3. Activation (one merge).** The implementation PR copies the staged tests and harness into live locations and adds the code. CI requires:
- the live test and harness files are byte-identical to the approved staging;
- every row of this change **executes and passes** (skipped, filtered or missing fails);
- all gates are valid (chained).

Merging lands the code and its tests together. Main never holds a test without its code, or code without its tests.

**4. Retirement (atomic with the replacement).**
- A superseding change lists the rows it retires in its spec delta; the tests gate approval covers that list.
- The old tests **stay live and required** until the replacement's implementation PR, which deletes them in the same merge that adds the new tests and code. stage-check only allows a live acceptance file to be deleted by a change whose approved `retires.json` lists every row tagged in it.
- If the replacement stalls or is abandoned, nothing was ever removed, so old coverage is preserved by construction.

**5. Overlapping changes.** Staged tests don't run on main, so change B making change A's rows pass breaks nothing. A's implementation PR simply finds those rows passing, which is all it needs. If two changes stage edits to the same harness file, the later one's hash no longer matches after the first merges: rebase → new tests gate PR (re-approval). The harness overlap is serialized, not silently merged. Because the manifest locks the whole acceptance folder and the runner config, *any* acceptance or harness file merged by another change after this change's tests gate also forces a re-run of the baseline and re-approval (ADR 0001; revisit for the team layer).

**6. PARTIAL.** If a change ships only some rows, it declares `PARTIAL` in `progress/`, names each unshipped row and its follow-on change, and those rows' staged tests aren't copied live. The tests gate approval for the follow-on change covers them later.

## Implementation conventions (pinned by the wf core plan and Plan 2a)
- **Change folder:** `docs/changes/<id>/`, where `<id>` is kebab-case (`^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$`). There's no separate slug.
- **`change.json`** (covered by the spec gate): `{ "level": "P0"|"P1"|"P2"|"P3"|"P4", "noBehaviourChange": boolean }`.
- **Staging mirrors live paths.** `docs/changes/<id>/design/stage/<live path>` and `docs/changes/<id>/tests/stage/<live path>`. For example, `design/stage/packages/contracts/openapi.yaml` stages `packages/contracts/openapi.yaml`. Staging holds whole files, never diffs.
- **`wf promote <id> <design|tests>`** copies staging into live paths. Builders use it at the start of BUILD; the implementation PR's byte-identity check compares live files with staging.
- **`retires.json`** (covered by the tests gate): a JSON array of row IDs this change retires. Optional; absent means none.
- **Rows:** example tables are markdown tables whose first header cell is `ID` and which include an `Expected` column. Row IDs match `^[A-Z][A-Z0-9]{1,9}-\d{1,4}$`. Write a literal pipe inside a cell as `\|`.
- **Tests carry row tags:** each acceptance test name contains `[ROW-ID]`. The project's test command must write a JUnit XML report (`workflow.config.json → test.junitReport`).
- **trace-check scope:** every live row (in `docs/specs/**`) plus every row in the change's delta, minus rows in `retires.json`, must have an executed, passing test **whose file is under `test.acceptanceDir`** (ADR 0001). The file comes from the JUnit test case's `file` attribute, else `classname`; a row-tagged case with no usable path fails closed. Row-tagged tests elsewhere still run but never satisfy a row. *Verified 2026-10-07 for vitest 5.0.3: `classname` is the repo-relative file path. Unverified for Jest and other runners.*
- **stage-check scope (ADR 0001):** after promotion, the live files under `test.acceptanceDir` must equal exactly the baseline manifest, minus files deleted for retired rows, plus this change's staged acceptance files, byte for byte. Every `test.harness` path must match the manifest unless this change staged it.
- **Superseded v1 limit:** trace-check used to credit row-tagged tests from anywhere. Dogfood run 1 (`docs/research/2026-10-07-wf-dogfood-1.md`) showed a runner-config exclude plus decoy tests passed every check with no code.
- **`workflow.config.json`:** `{ "approvers": ["<github-username>"], "test": { "setup": ["npm","ci"], "command": ["npx","vitest","run","--reporter=junit","--outputFile=reports/junit.xml"], "junitReport": "reports/junit.xml", "acceptanceDir": "tests/acceptance", "harness": ["vitest.config.ts"] } }`. `setup` is optional. `exempt` (optional, default none) lists repo paths, folders or single files, whose PRs skip the gates (D8); it is read from the base commit. `acceptanceDir` and `harness` are required (`harness` may be empty). List the runner config file in `harness` (the installer will fill it in) and add more paths (e.g. `package.json`) only if their churn is worth the extra re-approvals. `acceptanceDir` may not overlap `docs/changes/` or contain `junitReport`. Changing any `test` setting after the tests gate makes the baseline stale, which stage-check and trace-check report.
- **PR kind (D4, revised by D7).** From `git diff <base>...HEAD`, not the branch name. In order: (1) a PR that adds or changes (git status A, M or T) a `docs/changes/<id>/approvals/<gate>.json` is a **gate PR**: exactly one record, every changed path (deletions included) under `docs/changes/<id>/`, and no `change/<other-id>` head branch (closes the ADR 0001 manifest-from-branch attack). (2) Otherwise head branch `change/<id>` is an **implementation PR**; `change/<invalid-id>` is **rejected**. (3) Otherwise the PR is **exempt** and gets no `wf` checks only if every changed path is exempt (D8 to D10). (4) Otherwise it is **rejected**: one problem line per offending path, at most 10, and `wf classify` and `wf pr-check` exit 1. Kinds are `gate`, `change`, `exempt`, `rejected`. Deleting a record is not a gate PR (D6), and its folder is never exempt.
- **D7, default-deny.** The diff decides; the branch name can only add constraints (a `change/<id>` branch holds even an all-exempt PR to the full implementation checks). Before v2.8, step (3) passed any PR on any other branch, so an implementation change on `feat/x` skipped every check (Codex adversarial review, 2026-10-20, high).
- **D8, the exempt list.** `workflow.config.json → exempt`: repo paths (a folder or one file; no globs). A path is exempt if an entry covers it, the D9 floor does not, and it is a plain file. Empty or absent means nothing is exempt. Read from the **base** commit, like `approvers`, so a PR cannot exempt its own files. It is read only on step (3), so gate and implementation PRs do not depend on it. A base without a usable `workflow.config.json` fails a step-(3) PR.
- **D9, never-exempt floor** (case-insensitive, whole path segments): `.github`, `.workflow`, `workflow.config.json`, `AGENTS.md`, `CLAUDE.md`, `roles`, `docs/specs`, `docs/decisions`, `docs/changes`, `tests/acceptance`, `tests/harness`, the base config's `test.acceptanceDir` and `test.harness`; at any depth the file names `package.json`, `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock` and any name starting `vitest.config.`, `vite.config.` or `jest.config.` (the runner picks whichever variant exists). A test checks that every `templates/CODEOWNERS` path is under the floor. An `exempt` entry inside the floor is a config error; an entry that merely contains a floor path (`docs`) is allowed and the floor wins per file.
- **D10, what an exempt PR may contain.** Every path of a delete, add or rename (reported as delete plus add) must be exempt. A symlink (mode 120000) or submodule (160000) at any changed path, including a deletion of one, makes the PR non-exempt. A mixed PR is non-exempt. An empty diff is exempt.
- **`wf classify --base <ref> --branch <name>`** prints `kind=`, then `change=` and `gate=` when set, on stdout, safe to append to `$GITHUB_OUTPUT`. Problems go to stderr and print no key lines; exit 1.
- **`wf pr-check --base <ref> --base-branch <name> --branch <name> --repo <owner/name>`** classifies, then: a gate PR's own gate must be `valid` and its prerequisites' records must pass provenance; an implementation PR needs all three gates `valid` and all three records' provenance. An `exempt` PR, or one whose classification already failed, makes no GitHub call. Exit 0 pass, 1 fail (git and GitHub errors are failures), 2 usage error (missing flag, option-like `--base`, a flag on the wrong command). Problem lines have control characters escaped. `wf` never reads `GH_TOKEN`; `gh` does, and token-shaped strings are scrubbed from its error text.
- **`wf run-tests [--report-out <repo path>]`** runs `test.setup` then `test.command`, stopping at the first failure (exit 1). It deletes `test.junitReport` before the command, so only a report this run wrote can be copied to `--report-out`; a missing report after a successful run is an error.
- **CI jobs** (`templates/ci/wf.yml`, `on: pull_request`, `contents: read`): `gate-check` (`wf pr-check`, plus `pull-requests: read`), `memory-check` and `stage-check` run in parallel; `verify` needs `stage-check` and runs `wf run-tests --report-out .wf-report/junit.xml`, uploading artifact `junit-report` only on success (`include-hidden-files: true`: upload-artifact ≥4.4 skips dot-directories, *verified in the pinned v7.0.1 `action.yml`*); `trace-check` needs `verify` and downloads it. `stage-check` and `trace-check` act only on implementation PRs. All five are required checks (`integration_id: 15368`, the GitHub Actions app, *verified 2026-10-18*). Actions are pinned to commit SHAs. *Unverified:* the workflow has never run on GitHub and hasn't been linted with actionlint.
- **Trusted checkout (D3).** Each job checks out the PR into `pr/` (`fetch-depth: 0`, since provenance rejects shallow clones) and the base SHA into a sibling `trusted/`, and runs `node ../trusted/.workflow/wf/bin.js` with `pr/` as the working directory. Untrusted values (branch names, SHAs) reach scripts only through `env:`.

## Tests
| Layer | Written by | Locked | Runs |
|---|---|---|---|
| Acceptance (≥1 per row ID) | qa → Codex | yes | full, CI |
| Holdout variants | qa → Codex, stored outside the repo (CI secret / private repo) | builders can't read them | CI only |
| Characterization (brownfield) | explorer, confirmed by you | yes | full, CI |
| Unit / integration | builders (TDD) | no | fast + full |
| Contract conformance | generated from OpenAPI | harness locked | full |
- **One entry point**, `verify --fast|--full`, used by hooks, git hooks and CI.
- **trace-check:** every live row ID must have a test under `test.acceptanceDir` that actually *executed and passed*. Skipped, filtered, missing or out-of-folder tests fail. A live acceptance test may only be deleted by a change whose approved tests record lists that row as retired (checked by stage-check against the baseline manifest).
- **The harness is locked too:** runner configs, `package.json` test scripts, fixtures, seeds, helpers, clock control. `wf` hashes the `test.harness` paths into the baseline manifest; the rest rely on protected paths (Plan 2).
- **Flaky locked test:** quarantine needs your approval and expires; it never retries silently until it passes.

## Memory
| Memory | File | Writer | Enforced by |
|---|---|---|---|
| Index | context.md | agents, whenever structure or commands change | memory-check: size, links resolve |
| Glossary | glossary.md | orchestrator during CLARIFY | spec-lint: delta terms must exist in the glossary |
| Living spec | specs/** | folded in from the delta at archive | memory-check: no unarchived merged change |
| Decisions | decisions/** | design roles draft, you accept | contract/schema diff needs an ADR link **or** an explicit `no-ADR: <reason>` line in design.md |
| Decisions made in chat | changes/<id>/decisions-audit.md | orchestrator | memory-check |
| Handoff | progress/<branch>.md | agents; **every item closes with a reason**: handed-off / blocked / no-follow-on / canceled | Stop hook + memory-check |
| Lessons | lessons.md | agents, whenever you correct them | entries carry `stage: wip→provisional→established→canonical / superseded / retired` + a **warrant** (the incident that earned it); promoting to a rule or hook needs your review; demotion is announced; limit of 50 entries |

- **Loading rule:** always read context.md, glossary.md and lessons.md (established and above); read specs and ADRs only for the capability being touched.
- **Refocus hook:** after compaction (PostCompact / next UserPromptSubmit), re-inject context.md plus the active change's spec delta and tasks.
- An ADR is written only if a decision is expensive to reverse, would puzzle a future reader, and was a genuine trade-off.

## Trust boundary
- Agents use a **bot identity**: a separate account whose token can push branches and open PRs but not edit workflows or change settings. It can merge a PR after you approve it; provenance rejects records it merged, and you merge everything else. A fine-grained token can't be used by a collaborator on a personal repo (*verified 2026-10-19*), so the repo lives in an organization or the bot uses a classic token without the `workflow` scope; see `docs/guides/github-setup.md`.
- **Provenance** (see *Gates and approval records*) is the mechanical check that you approved a record. It holds only while agents never hold your token.
- A **ruleset** on main: PR required, checks required, code-owner review on protected paths. Rulesets are free on public repos; private repos need GitHub Pro (*verified 2026-10-07: the rulesets API refuses a private repo on the free plan*). This framework's own repo is public and runs `protect-main`: PR required, rebase-only and linear history, the CI `test` check required, no force pushes or deletion, no bypass. Installed projects get `templates/ruleset.json`: the same plus one approving review, code-owner review, stale-approval dismissal, last-push approval and the five `wf` checks.
- **Solo approver.** GitHub doesn't let an author approve their own PR (*verified 2026-10-19*), so under the shipped ruleset a PR you author can't merge. Either the bot opens every PR, approval records included (recommended), or a second approver account exists. Without either, use the guide's solo variant (`required_approving_review_count: 0`, no code-owner review; this repo's own `protect-main` does this): same checks, but GitHub enforces no human review and agents run as you, so provenance proves nothing.
- **`wf` runs from the base commit (D3).** CI runs `wf` from a checkout of the PR's base SHA, so a PR can't edit its judge. This holds only if `.workflow/wf/bin.js` is a self-contained bundle that resolves nothing from `node_modules` (installer requirement, Plan 3). The `tsc` output in `dist/` is not one (it imports `fast-xml-parser`), so the guarantee can't be met by hand before Plan 3. The workflow file itself comes from the PR's merge commit under `pull_request`, so trust in it rests on the code-owner review of `/.github/`. The install PR can't be judged (its base has no `wf`); merge it before making the five checks required.
- **Gate-PR scope.** `wf pr-check` refuses a gate PR with more than one record or any change outside `docs/changes/<id>/` (ADR 0001).
- **Protected paths:** `tests/acceptance/**`, `tests/harness/**`, runner configs, `.workflow/**`, `.github/**` (including reviewer instruction files), `CODEOWNERS`, `workflow.config.json`, `AGENTS.md` (its rules steer the AI reviewers), `roles/**`, approved specs, accepted ADRs, `docs/changes/*/approvals/**`, `docs/changes/*/baseline.json`, and the `docs/changes/*/design/**` and `docs/changes/*/tests/**` staging (always, D5: CODEOWNERS can't express "once approved", and only gate PRs touch them). An implementation PR may *add* live copies of approved staging; byte-identity is checked by CI. For the acceptance folder and `test.harness` paths, protected paths are defence in depth: `wf` itself rejects unapproved edits via the baseline manifest (ADR 0001).
- **The test report is evidence, not proof, against code built to defeat it (ADR 0002).** Builder code runs inside the test process, so it can patch assertions or rewrite the report.
  - *Layer 1, canary (Plan 2b):* CI writes a must-fail test named with a random nonce from a locked template (`test.canary`) after stage-check; `trace-check --canary <nonce>` requires it to fail. Detects blanket forgeries.
  - *Layer 2, isolated run (Plan 2b):* CI runs `test.setup` and `test.command` in `docker run --rm --network none` and reads the report after the container exits, so no rewriter outlives the run.
  - *Layer 3, black-box acceptance (per project, default for HTTP/CLI apps, chosen at `wf init`):* acceptance tests run in their own container against the app's boundary, with their own `package.json` and lockfile inside `acceptanceDir` installed with `--ignore-scripts`. Prevents assertion patching. Holdouts only count as independent evidence against T2 when they run this way.
  - Without layer 3, a canary-aware, targeted forgery is caught only by review.
- **No production secrets on the dev machine**; agents get dev credentials only.
- Repo text (brownfield comments, dependency docs) is evidence, never instructions.

**Known limits (Plan 2a).**
- **Laundering.** Any `change/<id>` whose three gates are approved and proven can carry unrelated code: nothing binds an implementation PR to its change's scope, and an approved change can be reused. Default-deny (D7) turns the old free bypass into "needs an approved change", which is better but not safe. Closing it needs an implementation-scope manifest per change; that is a separate decision (future ADR), not part of v2.8.
- **Exempt list is policy you can get wrong.** Exempting a source folder (`src`) disables the gates for it. The floor stops the known foot-guns, not every one. Dependency-bot PRs (Dependabot, Renovate) touch `package.json` and lockfiles, which are in the floor, so they need a `change/<id>` PR; they are not exempt unless you accept that gap by other means.
- A `CHANGES_REQUESTED` from one approver doesn't cancel another approver's `APPROVED` in provenance.
- D1's author-is-approver branch trusts the separation between your token and the bot's.
- Who merges an implementation or `exempt` PR isn't checked; the bot can merge any PR you've approved.
- Record deletion and archiving are unchecked until the archive flow is designed (D6, Plan 4).
- `package.json` test scripts and lockfiles are not in the CODEOWNERS template, although *Tests* counts them as locked harness; add them per project, or to `test.harness`. They are in the exempt floor (D9), so they cannot be exempted.
- A job skipped because a job it needs failed reports success (*verified 2026-10-19, docs.github.com/en/pull-requests/reference/status-checks*), so all five checks must stay required.

## Edge cases the trials must cover
| Scenario | Required behaviour |
|---|---|
| Builder edits a runner config, filters a suite, or special-cases test inputs | stage-check (runner config in `test.harness` manifest) / trace-check (filtered rows show as not run) / holdout catches it |
| Builder adds decoy tests tagged with row IDs outside the acceptance folder | trace-check ignores them; the real rows still need passing acceptance tests |
| Builder adds a decoy file inside the acceptance folder, or edits an older live acceptance test | stage-check: file not in the approved manifest or staging |
| Two changes claim the same row ID or ADR number | IDs namespaced per change; ADR number assigned at merge |
| Change abandoned after its tests gate | its staged tests never went live, so main is unaffected; archive the change as abandoned |
| You change your mind after the tests gate | revise the spec → new spec record → design and tests invalidated transitively → re-approve |
| Spec re-approved after tests were approved | chained binding: tests record's `requires` hash no longer matches → tests gate invalid until re-approved |
| Design edited after approval | hash mismatch → design gate invalid, and tests with it → implementation PRs blocked until new gate PRs |
| Implementation PR changes the live contract, migration, tests or harness vs the approved staging | byte-identity check fails |
| Rows that already pass before implementation (unchanged rules, brownfield) | recorded as `passes` in the approved baseline; allowed |
| A row the delta says is new, but which passes at baseline | flagged at the tests gate; you decide (weak test vs existing behaviour) before approving |
| Change B happens to make change A's rows pass | no effect on main (staged tests aren't live); A's implementation PR finds them passing |
| Superseding change abandoned | old tests were never removed (deletion only happens in the replacement's implementation PR) |
| PR deletes a live acceptance test it has no approved retirement for | stage-check fails (file missing from manifest, rows not retired) |
| A correct implementation | staged tests copied live byte-identical → all its rows pass → CI green → code + tests land in one merge |
| Bot opens a PR adding an approval record | can't be merged without your review; a record that reached main without your approval fails gate-check |
| PR edits `AGENTS.md` review rules to weaken the AI review of that same PR | protected path: can't merge without your code-owner review; the AI review is advisory, so a weakened review can't pass any gate on its own |
| An AI reviewer approves a PR | the approval doesn't count toward required approvals; the PR still needs yours |
| Major dependency upgrade breaks many acceptance tests | P0 upgrade lane: implementation fixes only, no spec change |
| Lead session dies mid-change | a new orchestrator resumes from `progress/` + `tasks.md` alone |
| Implementation code disables the test library's assertions | layer 1 canary passes → trace-check fails; prevented outright under layer 3 |
| A test spawns a process that rewrites the JUnit report after the run | layer 2: the container's processes die with it before the report is read |
| A dependency's install script patches the test runner | layer 3: acceptance deps come from a locked lockfile installed with `--ignore-scripts`; otherwise review |
| Teammate marks a task done without doing it | TaskCompleted hook + trace-check; the docs say task status can lag |
| Builders edit the same file | owned-path hook blocks it; overlap → work serialized |
| Codex quota exhausted | fallback: a fresh-context Claude subagent with no access to the implementation, **labelled reduced independence** |
| Brownfield repo with no CI | change #0 bootstraps verify + CI |

## Phase 0 carry-over
OpenSpec's living specs, change deltas and archive match this layout. Trial hosting the lifecycle on an OpenSpec custom schema; fall back to our own format with the same layout.

## Open questions
- Spike S2: do split-pane teammates (one process each) keep `EnterWorktree` local, so parallel builders can return? Also untested in Spike S: whether the owned-path hook blocks an Edit, the Bash bypass, and Codex from a teammate.
- Agent teams are experimental. What breaks on Claude Code updates, and what's the fallback (subagents plus file handoffs)?
- Codex as a tool, not a peer: is a one-shot Codex QA enough, or does QA need a persistent Codex conversation?
- Subscription limits with 4–5 concurrent roles; whether to cap parallel builders at 2.
- Tool and package name; how change IDs are generated; whether the managed-block upgrade survives hand edits.

## Validation
1. **Trial 1:** one P1 change through the full team (orchestrator, db-designer, backend-dev → frontend-dev, qa/Codex, integrator, reviewer/Codex).
2. Greenfield pilot: 3 changes. Then one existing TS repo: 3 changes, including MAP.
3. **Adversarial trials:** every gate must fail on a planted fault (a seeded-regression pair). A gate that passes on the planted fault doesn't count. These must include:
   - a correct implementation goes green and merges, with code and tests landing together;
   - an edit to `design/` after approval blocks the next PR;
   - re-approving the spec after the tests gate invalidates design and tests;
   - a bot-merged approval record is rejected;
   - a brownfield change whose rows already pass at baseline gets through;
   - an implementation PR that alters a staged test or deletes an unretired live test is rejected;
   - no implementation plus a runner-config exclude and decoy row tags (outside and inside the acceptance folder) is rejected (ADR 0001);
   - implementation code that disables assertions, and a test that rewrites the report after the run, are both rejected (ADR 0002 layers 1–2);
   - an abandoned superseding change leaves the old coverage intact.
4. **Metrics per change:** your minutes per gate, rework loops, test disputes, CONTEXT-GAP vs JUDGMENT-GAP counts, escaped defects. A gate that hasn't rejected anything in 10 changes gets cut or automated.
