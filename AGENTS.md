# agentic-workflow

A reusable agentic development workflow for TypeScript repos, greenfield and brownfield. It covers how project memory is stored, how specs and decisions are made, who writes and runs tests, and how an orchestrator and role agents (Claude + Codex) cooperate. It will be installed into projects with `npx <tool> init`.

This repo is the **framework itself**, not an app. Don't bake any app's stack choices into it.

## Status
Design phase. No framework code yet.
- Current design: `docs/specs/2026-09-29-agentic-workflow-design.md` (v2.1). Read it before proposing changes.
- Superseded design: `docs/specs/2026-09-26-agentic-framework-design.md`. Don't use it.
- Research: `docs/research/`.

## Rules
- The design doc is the source of truth. If you change direction, update the doc in the same step; never only in chat.
- Every decision must land in a file (design doc or a future `docs/decisions/` ADR), never just in a message.
- Mark facts about external tools (Claude Code, Codex, OpenSpec, GitHub) as verified, with a source, or as unverified. These tools change monthly.
- Keep workflow logic in plain Node/TS scripts any agent can call. Hooks and agent definitions are thin wrappers.
- Don't commit, push or publish unless asked.
- Never log or commit secrets, tokens, or credentials.
