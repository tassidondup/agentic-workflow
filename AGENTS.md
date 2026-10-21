# agentic-workflow

A reusable agentic development workflow for TypeScript repos, greenfield and brownfield. It covers how project memory is stored, how specs and decisions are made, who writes and runs tests, and how an orchestrator and role agents (Claude + Codex) cooperate. It will be installed into projects with `npx <tool> init`.

This repo is the **framework itself**, not an app. Don't bake any app's stack choices into it.

## Status
Plan 1 (the `wf` core gate engine, `src/`) is merged: `docs/superpowers/plans/2026-10-05-wf-core-gate-engine.md`. ADR 0001 (decoy-test fix) is implemented.
- **Plan 2a, GitHub enforcement, is built** (`docs/superpowers/plans/2026-10-18-plan-2a-github-enforcement.md`): `wf classify`, `pr-check` (provenance, gate-PR scope) and `run-tests`; `templates/ci/wf.yml`, `templates/CODEOWNERS`, `templates/ruleset.json`; setup guide `docs/guides/github-setup.md`. **Classification is default-deny (design v2.8):** a PR that is not a gate PR or on a `change/<id>` branch must have every path in the base config's `exempt` list, outside the never-exempt floor; **CI takes the test command from the base commit (v2.9, D11).** **Plan 2b, test isolation, is built (v2.10):** `wf run-tests --isolate --canary` and `wf trace-check --canary` (ADR 0002 layers 1–2, on branch `feat/plan-2b-test-isolation`). **Live GitHub verification is pending** (guide section 7, needs a bot account).

Next, in order:
- **Live GitHub verification (guide section 7)** comes before layer 3: the workflow has never run on GitHub, and Docker on `ubuntu-latest` and the nonce hand-off between jobs are unverified. **After it, switch the repo from rebase-only to merge commits** (the user's decision, 2026-10-22): update `templates/ruleset.json` (`required_linear_history`, allowed merge methods), the guide (lines on rebase-only and "matches this framework's own `protect-main`"), the repo ruleset and merge buttons, and re-verify provenance with a merge commit. Remind the user when the live run is done.
- **Layer 3 of ADR 0002 (black-box acceptance in its own container)** is what prevents a forger that reads the canary (the Codex finding on 2b); it is chosen per project at `wf init` (Plan 3). Plan: brainstorm SiteOps' architecture, then a spike (trivial HTTP app, locked compose file, Playwright container, can PR code break the boundary?), then an ADR. Design constraints found so far: the compose file must be a locked `test.harness` file; it fits services over a network protocol only, so libraries and CLIs (including `wf`) stay at layers 1–2; DB and external-API stubs must be locked too. Until then CI green means "evidence, not proof".
- **Spike S is done** (`docs/research/2026-10-17-spike-s.md`): builders run one at a time (design v2.6). **SiteOps** is the greenfield pilot. **Spike S2** (split-pane teammates, owned-path deny, Bash bypass, Codex from a teammate) comes before Plan 4 if parallel builders are wanted. Then Plan 3 installer, Plan 4 team layer, Plan 5 Trial 1.

Reference:
- Current design: `docs/specs/2026-09-29-agentic-workflow-design.md` (v2.10). Read it before proposing changes.
- Superseded design: `docs/specs/2026-09-26-agentic-framework-design.md`. Don't use it.
- Research: `docs/research/`. Decisions: `docs/decisions/`.

## Rules
- The design doc is the source of truth. If you change direction, update the doc in the same step; never only in chat.
- Every decision must land in a file (design doc or a future `docs/decisions/` ADR), never just in a message.
- Mark facts about external tools (Claude Code, Codex, OpenSpec, GitHub) as verified, with a source, or as unverified. These tools change monthly.
- Keep workflow logic in plain Node/TS scripts any agent can call. Hooks and agent definitions are thin wrappers.
- Don't commit, push or publish unless asked.
- Never log or commit secrets, tokens, or credentials.
