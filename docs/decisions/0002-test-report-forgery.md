# 0002. Defend the test report against builder code

**Status:** Accepted (2026-10-07). Design doc updated to v2.5. Layers 1–2 are built in Plan 2; layer 3 and the review rule ship with the installer (Plan 3).
**Follows:** ADR 0001 (*Not solved*, first bullet). **Evidence:** the final review of the ADR 0001 branch (PR #3).

## Context
ADR 0001 made `wf` check the report's *structure*: which rows ran, in which files, with what result. It can't check that the run was *honest*. The test command runs code the builder wrote, in the same process and on the same disk as the test runner and its report. The final review forged a green report two ways, without editing any locked file:

1. **Assertion patching.** Implementation code imports the test library and switches its assertions off (`chai.Assertion.prototype.assert = () => {}`). `expect(price()).toBe(42)` passes against `price = () => 0`; vitest exits 0 and writes a clean report.
2. **Post-run rewrite.** A test spawns a detached process that waits for vitest to write `junit.xml`, then rewrites it to all-pass.

A third route is the same class: a `postinstall` script or lockfile change runs during `test.setup` and patches the runner.

Facts this ADR relies on:
- *Verified 2026-10-07:* GitHub Actions kills leftover processes only at the end of the **job** ("Complete job"), not between steps. A rewriter started in the test step keeps running through later steps of the same job. Sources: [actions/runner #4601](https://github.com/actions/runner/issues/4601), [community discussion #58311](https://github.com/orgs/community/discussions/58311).
- *Verified 2026-10-07:* when the init process (PID 1) of a Linux PID namespace exits, the kernel SIGKILLs every other process in it. A container's processes therefore can't outlive its main process. Source: [pid_namespaces(7)](https://man7.org/linux/man-pages/man7/pid_namespaces.7.html).
- *Unverified:* every way builder code can reach vitest's assertion state without an `import` (e.g. through globals). Assume it can.

### Threat model
| Level | Who | Examples | Today |
|---|---|---|---|
| **T1, reward hacker** | An agent that wants green and takes shortcuts | edits or skips tests, filters the runner, decoy tests, special-cases test inputs | Blocked by `wf` (ADR 0001) + holdouts |
| **T2, saboteur** | Code written to defeat the measurement itself | assertion patching, report rewrite, install hooks | **Not detected** |

T1 is the common failure of coding agents. T2 needs deliberate intent, but an agent under pressure to make a red suite green can reach it, and a prompt injection in a dependency or brownfield comment could ask for it. Nothing in-process can fully stop T2: whatever runs in the test process can change what the test process reports.

## Decision
Detect T2 everywhere cheaply. Prevent it where the project has a process boundary. Three layers, plus a review rule.

**Layer 1: canary (`wf` core, every project).**
- CI makes a random nonce per run, then runs `wf canary write <nonce>`. That writes a must-fail test into the acceptance folder from a locked template: `test.canary.template` (a `test.harness` file, e.g. `tests/harness/canary.test.template.ts`). The template's single test asserts something false and is named `[canary:<nonce>]`. It is written to `test.canary.path` inside `acceptanceDir`.
- Order in CI: `stage-check` → `wf canary write` → test command → `trace-check --canary <nonce>`.
- `trace-check --canary` fails unless the report holds exactly one case named with that nonce, from `test.canary.path`, with status **failed**. Missing, skipped or passing means "this run's report can't be trusted".
- **Catches:** global assertion disabling, blanket all-pass rewrites, and runner filters that drop unknown files.
- **Misses:** a targeted forgery that spares the canary. Builder code can read the canary file while the tests run. This layer raises the bar; it doesn't close the hole.

**Layer 2: isolated test run (Plan 2 CI template).**
- CI runs `test.setup` and `test.command` inside `docker run --rm --network none`, with the repo mounted and the report written to a mounted folder. The host reads the report only after the container has exited, then runs `wf` on the host from the checked-out commit.
- **Catches:** any rewriter still alive after the test command ends, because the PID namespace dies with the container (fact above). It also stops network exfiltration from tests.
- **Misses:** a rewrite in the moments between vitest writing the report and exiting, and assertion patching (it happens inside the run).

**Layer 3: black-box acceptance tests (per project; see question 2).**
- Acceptance tests drive the system only through its outside boundary (HTTP, CLI, a built package) and run in their **own container**. The app runs in a second container that can't see the test process or the report folder.
- The acceptance folder carries its own `package.json` and lockfile. Being inside `acceptanceDir`, both are locked by the ADR 0001 manifest. They are installed with `npm ci --ignore-scripts`, so builder-controlled install hooks never run in the test container.
- **Catches:** assertion patching and report tampering by implementation code. It is the only layer that *prevents* T2.
- **Costs:** the app must run in a container with a boundary the tests can call. Tests get slower. It doesn't fit pure libraries, which stay at layers 1–2.
- Holdouts belong here too. In-process holdouts are defeated by the same assertion patch, so a holdout is only independent evidence if it runs out of process.

**Review rule (advisory).** The installer's managed `AGENTS.md` block (Plan 3) adds to *Code Review Rules*: flag any non-test file that imports a test library; any test that spawns processes or writes outside its temp folder; any write to the JUnit report path; and any new or changed install script (`preinstall`, `postinstall`, `prepare`) or lockfile entry with install scripts.

## Consequences
**Gains**
- T2 goes from *undetected* to *detected* for blanket forgeries (layer 1) and post-exit rewrites (layer 2), and *prevented* in black-box projects (layer 3).
- The design stops implying that green CI is proof. It becomes proof for T1 and evidence for T2, and the docs say which.

**Costs**
- Layer 1: a `wf canary` command, `test.canary` config, a template per runner (the installer ships the vitest one) and a `--canary` option. About half a day.
- Layer 2: Docker in CI. Slower runs (an image pull plus `npm ci` in the container). Local `verify` stays un-isolated, so it's an early signal only.
- Layer 3: a test architecture choice each project makes up front. Retrofitting a brownfield repo is expensive.

**Not solved**
- A targeted, canary-aware forgery in a project without layer 3. The final backstops stay human review and the Codex reviewer, with the review rule above to point them at the right places.
- A compromised CI runner or base image. That's outside the repo's trust boundary.

## Alternatives considered
- **A static gate: fail if non-test code imports a test library.** Rejected as a gate: builder code can likely reach the library through globals without an import (unverified, but assume it). Kept as a review rule, where a false negative costs nothing extra.
- **Run the suite twice and compare.** Rejected: a forger produces the same forged result twice.
- **Make the reporter write to stdout instead of a file.** Rejected: child processes inherit stdout and can inject forged XML too.
- **Rely on holdouts.** Rejected for T2: in-process holdouts pass under the same assertion patch. They stay the defence against special-casing (T1).
- **Accept T2 as out of scope.** Possible (question 1), but then the design must stop calling CI green a guarantee. A cheap canary costs less than that wording change undermines.

## Decisions (2026-10-07)
1. **Threat model:** T2 is in scope. Detect it everywhere (layers 1–2); prevent it where a project opts into layer 3.
2. **Layer 3 policy:** the recommended default for projects with an HTTP or CLI boundary, chosen during `wf init` (Plan 3) and recorded in the project's `workflow.config.json`. It is not tied to planning levels, because retrofitting it mid-project is the expensive part.
3. **Timing:** layer 1 (canary) is built in Plan 2 together with layer 2 (isolated CI run), since its ordering and nonce live in the CI template. T1 is already covered by ADR 0001, so nothing ships before Plan 2.

Plan 2 scope from this ADR: `wf canary write`, `trace-check --canary`, `test.canary` config and the vitest template, and the containerized CI test step. Plan 2 also carries ADR 0001's gate-branch fix: CI refuses a tests-gate PR that changes anything outside `docs/changes/<id>/**`.
