# agentic-workflow

A reusable agentic development workflow for TypeScript repos, greenfield and brownfield. It covers how project memory is stored, how specs and decisions are made, who writes and runs tests, and how an orchestrator and role agents (Claude + Codex) cooperate. It will be installed into projects with `npx <tool> init`.

This repo is the **framework itself**, not an app. Don't bake any app's stack choices into it.

## Status
Plan 1 (the `wf` core gate engine, `src/`) is merged: `docs/superpowers/plans/2026-10-05-wf-core-gate-engine.md`. ADR 0001 (decoy-test fix) is implemented. Next: Plan 2 (GitHub enforcement) and Spike S (agent teams + worktrees + Codex).
- Current design: `docs/specs/2026-09-29-agentic-workflow-design.md` (v2.4). Read it before proposing changes.
- Superseded design: `docs/specs/2026-09-26-agentic-framework-design.md`. Don't use it.
- Research: `docs/research/`. Decisions: `docs/decisions/`.

## Rules
- The design doc is the source of truth. If you change direction, update the doc in the same step; never only in chat.
- Every decision must land in a file (design doc or a future `docs/decisions/` ADR), never just in a message.
- Mark facts about external tools (Claude Code, Codex, OpenSpec, GitHub) as verified, with a source, or as unverified. These tools change monthly.
- Keep workflow logic in plain Node/TS scripts any agent can call. Hooks and agent definitions are thin wrappers.
- Don't commit, push or publish unless asked.
- Never log or commit secrets, tokens, or credentials.
