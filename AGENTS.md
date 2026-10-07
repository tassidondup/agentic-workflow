# agentic-workflow

A reusable agentic development workflow for TypeScript repos, greenfield and brownfield. It covers how project memory is stored, how specs and decisions are made, who writes and runs tests, and how an orchestrator and role agents (Claude + Codex) cooperate. It will be installed into projects with `npx <tool> init`.

This repo is the **framework itself**, not an app. Don't bake any app's stack choices into it.

## Status
Plan 1 (the `wf` core gate engine, `src/`) is merged: `docs/superpowers/plans/2026-10-05-wf-core-gate-engine.md`. ADR 0001 (decoy-test fix) is implemented. Next, in order:
- **Plan 2a, GitHub enforcement:** provenance check (an approval record counts only if an approver's account merged its PR, via the GitHub API), the CI workflow template (`verify`, `gate-check`, `stage-check`, `trace-check`, `memory-check`), CODEOWNERS and protected paths, the bot identity and ruleset setup guide, and refusing tests-gate PRs that change anything outside `docs/changes/<id>/**` (ADR 0001).
- **Plan 2b, test isolation (ADR 0002 layers 1–2):** `wf canary write`, `trace-check --canary`, `test.canary` config and the vitest template, and running the test command in `docker run --rm --network none` with the report read after the container exits. Builds on 2a's CI template.
- **Spike S** (agent teams + per-builder worktrees + hooks + Codex CLI) can run in parallel with 2a. Then Plan 3 installer, Plan 4 team layer, Plan 5 Trial 1.

Reference:
- Current design: `docs/specs/2026-09-29-agentic-workflow-design.md` (v2.5). Read it before proposing changes.
- Superseded design: `docs/specs/2026-09-26-agentic-framework-design.md`. Don't use it.
- Research: `docs/research/`. Decisions: `docs/decisions/`.

## Rules
- The design doc is the source of truth. If you change direction, update the doc in the same step; never only in chat.
- Every decision must land in a file (design doc or a future `docs/decisions/` ADR), never just in a message.
- Mark facts about external tools (Claude Code, Codex, OpenSpec, GitHub) as verified, with a source, or as unverified. These tools change monthly.
- Keep workflow logic in plain Node/TS scripts any agent can call. Hooks and agent definitions are thin wrappers.
- Don't commit, push or publish unless asked.
- Never log or commit secrets, tokens, or credentials.
