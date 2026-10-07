# 0001. Count rows only from the acceptance directory, and lock its contents in the baseline

**Status:** Proposed (2026-10-07). Needs your acceptance before implementation.
**Evidence:** `docs/research/2026-10-07-wf-dogfood-1.md`, finding P0.

## Context
trace-check and baseline credit a row to any executed test whose name carries `[ROW-ID]`, wherever the test lives. stage-check only compares the files this change staged with their live copies.

Dogfood run 1 showed what that allows. With **no feature code**, a builder:
1. adds `exclude: ['tests/acceptance/**']` to `vitest.config.ts`;
2. adds `src/decoy.test.ts` with trivially passing tests named `[SHP-003]`, `[SHP-005]`, …

Result: stage-check exit 0 (the approved acceptance file is untouched), trace-check exit 0 (every row has an executed, passing test). The design called this a "v1 limit" covered by Plan 2's protected paths. Plan 2 can only flag the runner-config diff for code-owner review; the bypass still reaches you as a green PR, and catching it depends on you reading a one-line config change.

Two smaller holes come from the same gap:
- A decoy file planted *inside* the acceptance folder isn't staged, so stage-check never looks at it.
- Live acceptance tests from earlier changes can be edited freely; nothing compares them with what was approved.

## Decision
Three changes to the `wf` core. No GitHub dependency.

**1. `test.acceptanceDir` (required).** New field in `workflow.config.json`, e.g. `"tests/acceptance"`. trace-check and baseline count a JUnit test case towards a row only if its file is under `acceptanceDir`. A test outside it still runs and can fail the build, but never satisfies a row.
- File identity comes from the test case's `file` attribute if present, else `classname`. *Verified 2026-10-07 for vitest 5.0.3:* `classname` is the repo-relative file path (`src/decoy.test.ts`, `tests/acceptance/shipping/member.test.ts`). *Unverified:* Jest (`jest-junit` sets `classname` from a template; a `file` attribute is opt-in) and other runners. The installer must configure the reporter so the path is present; `wf` fails closed when a row-tagged case has no usable path.
- Effect on the bypass: the decoys stop counting, and the excluded acceptance tests show as `not-run`, so trace-check fails.

**2. Acceptance manifest in `baseline.json`.** `wf baseline` records `acceptance: [{ path, sha256 }]` for every file under `acceptanceDir` on HEAD, and `harness: [{ path, sha256 }]` for every path in a new `test.harness` list (default: the runner config file). Both are covered by the tests-gate hash, so you approve them with the baseline.

**3. stage-check checks the whole acceptance dir and the harness.** After promotion, the live files under `acceptanceDir` must equal exactly:
`manifest − files deleted for retired rows + this change's staged acceptance files`, byte for byte. Any extra, missing or edited file fails. Every `test.harness` path must match the manifest unless this change staged it.
- A deleted live file is allowed only if every row tag it contained is in `retires.json` (this also covers the design's "retired-test deletion" rule, finding P2 in the dogfood report, without needing a git diff).

## Consequences
**Gains**
- The P0 bypass fails in `wf` on the builder's machine and in CI, before review. Plan 2's protected paths stay as defence in depth, not the only line.
- Edits to *old* live acceptance tests and runner configs are caught, which no current check does.
- Retired-test deletion gets a mechanical check.

**Costs**
- **More re-approvals.** If another change merges new acceptance files or a runner-config edit after this change's tests gate, this change's manifest is out of date: stage-check fails until you re-run the baseline and re-approve tests. That serializes concurrent changes that touch acceptance tests or harness. The design already serializes harness overlap, but this widens it to any acceptance file. Acceptable while you're the only approver; revisit for Plan 4 (team layer).
- `test.harness` must list the right files. Too few and a filter edit slips through; too many (e.g. `package.json`, which changes with every dependency bump) and re-approvals get noisy. Default to the runner config only; projects opt into more.
- `baseline.json` and `inputs_sha256` gain fields; existing tests and fixtures need updating.

**Not solved**
- A custom JUnit reporter, or a reporter option that rewrites `classname`, can still forge paths. That edit has to go into a runner config or harness file, so part 3 catches it if that file is in `test.harness`. A test that lies (e.g. mocks the code under test) is still caught only by review and holdouts.
- A test command changed in `workflow.config.json` is already bound by `inputs_sha256`. A change to it in CI is outside `wf`'s reach (Plan 2).

## Alternatives considered
- **Rely on Plan 2 protected paths and CODEOWNERS only.** Rejected: it turns a mechanical guarantee into "you notice a one-line config diff", which is the review load this workflow exists to remove.
- **Only part 1 (`acceptanceDir`).** Closes the reported bypass but leaves decoy files inside the acceptance dir and edits to old acceptance tests unchecked. Rejected as half a fix.
- **Diff against main in stage-check (`git diff main...HEAD`).** Rejected for the core: it depends on branch names and fetch state, and CI checkouts are often shallow. The manifest is self-contained and already hashed by the tests gate.

## On acceptance
- Update the design doc: replace the "v1 limit" line in *Implementation conventions*, add `acceptanceDir`, `harness` and the manifest to the `workflow.config.json` and `baseline.json` shapes, and narrow Plan 2's protected-paths role to defence in depth.
- Implement as a small plan before Plan 2, with an adversarial test for each attack: decoy outside the dir, runner-config exclude, decoy inside the dir, edited old acceptance test, deleted unretired test.
