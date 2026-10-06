# Agentic Software Development Framework — Design

> **Superseded** by `2026-09-29-agentic-workflow-design.md`.

## Context
Goal: a reusable, solo-use framework where the human spends time on **specs + success/failure scenarios**, and AI (Claude Code + Codex) does planning, contracts, schema, implementation, testing, deploy. Repo `agentic-workflow` is empty. Classification: **architectural** → evaluation spike → written design spec → implementation plan.

## Decisions so far (stated by user)
| Area | Decision |
|---|---|
| Purpose | Reusable framework, **just me** |
| Targets | Web SaaS, APIs, RN mobile (mobile deferred in pilot) |
| Build vs adopt | **Evaluate existing tools first** |
| Human gates | Approve plan · approve OpenAPI + DB schema · review every PR |
| Scenario format | **Example tables** (input → expected output per rule) |
| Runtime | **Local Claude Code**; Claude Code + Codex subscriptions for dev; AI Gateway spend only for app-level Jev |
| Stack | One blessed TS stack: separate TS API on **Railway**, **Next.js on Vercel**, **Supabase** (Postgres + Auth) |
| Contracts | **OpenAPI-first** |
| Authz | **API layer only** (verify Supabase JWT, service role, RLS deny-all backstop) |
| Lifecycle | Deploy/infra, perf budgets + load tests, **security gates (mandatory authz scenarios + dep/secret/SAST scans)** |
| Stuck policy | Stop and ask me (after Codex rescue attempt) |
| Codex role | Writes acceptance tests from tables · independent PR reviewer · stuck-rescue |
| Unit of work | Vertical slice |
| Pilot | Marketplace app; **framework lives inside pilot repo, extracted after 3–5 slices** |
| Test env | Local Supabase (Docker) |
| Pilot sequencing | Web + API first; payments deferred; mobile later |
| AI decisions in apps | **Jev (TypeSafe AI) via Vercel AI Gateway** as blessed pattern for classify/score/boolean decisions; AI Gateway spend accepted |

## Jev integration — "decision spec" as a first-class slice type
Jev = System One model: typed questions (choice ≤255 opts / score 2–10 levels / boolean) over state ≤32k tokens → probabilities + confidence; no text/code generation. $0.042/1M input tokens. Called via AI SDK `experimental_evaluate({ model: 'typesafe-ai/jev', state, questions })`.
Scope: **app-level only** (marketplace: listing moderation, message spam/scam, categorization, dispute routing). Not used inside the dev pipeline.

Decision spec template (`specs/<slice>/decisions/<name>.md`):
- Question definition (type, instructions, criteria)
- Example table: `id | state (input) | expected answer` — ≥ N rows incl. adversarial/borderline cases
- Accuracy target (e.g. ≥95% on table) + confidence threshold → below it, route to human review queue
- Fallback behaviour when Jev is unavailable/times out (fail-closed vs fail-open, stated per decision)

Pipeline additions:
- Codex generates `evals/<decision>.eval.ts` from the table (locked like acceptance tests)
- Claude implements the question as a typed module in `packages/decisions/` (single place wrapping `evaluate`, timeouts, logging of confidence, no PII in logs)
- Gate: eval run against real Jev must meet accuracy target; unit/acceptance tests use a recorded-fixture mock so CI isn't flaky/costly
- Risks to track: `experimental_` API may change (pin AI SDK version); Railway API needs AI Gateway API key (verify — OIDC only on Vercel); check TypeSafe's published model-limitations page against each decision's domain

## Assumptions (not yet confirmed)
- Monorepo (pnpm workspaces): `apps/api`, `apps/web`, later `apps/mobile`, `packages/contracts` (OpenAPI + generated clients).
- API framework TBD (Hono vs Fastify vs NestJS) — decide in design spec.
- Example tables live in markdown with stable row IDs for traceability.

## Target pipeline (per vertical slice)
```
1. SPEC      you: specs/<slice>/spec.md — rules + example tables (success, failure, authz) + NFR budgets
2. CLARIFY   Claude: gap hunt (concurrency, partial failure, authz, empty/limit cases) → questions → you answer → spec frozen
3. TESTS     Codex: tables → acceptance tests (tests/acceptance/<slice>/*) → you approve → LOCKED
             (PreToolUse hook blocks Claude edits to locked paths; CI verifies checksum)
4. DESIGN    Claude: OpenAPI diff + SQL migration + task plan  → GATE: you approve
5. BUILD     Claude in git worktree, TDD for unit tests; fail N=3 → Codex rescue → stop & ask you
6. GATES     typecheck · lint · unit · locked acceptance · OpenAPI contract conformance ·
             authz matrix · perf (k6 vs budget) · dep audit · secret scan · SAST · traceability
             (every table row ID has ≥1 test, else fail)
7. REVIEW    Codex review → you review PR → merge
8. DEPLOY    Supabase migration → Railway API → Vercel web (prod deploy manual approval)
```
Key design principle: **the implementer never grades its own homework** — scenario tests are authored by a different model and locked.

## Phase 0 — Evaluation spike (next step)
Candidates (verified to exist, Sep 2026): **GitHub Spec Kit** (Claude Code plugin; constitution → specify → clarify → plan → tasks → implement), **OpenSpec** (lightweight change specs; best merge rate in Uvik benchmark), **BMAD-METHOD** (multi-role agent team), **superpowers** (already installed: brainstorming → writing-plans → subagent TDD). Kiro excluded (VS Code fork, conflicts with local Claude Code choice).

Score each against: (1) supports example-table scenarios, (2) lets tests be authored by a separate model + locked, (3) human gates at plan/contract/schema, (4) OpenAPI-first, (5) Codex integration, (6) overhead per slice, (7) extractability to a reusable plugin.

Method: read docs/source; run **one tiny identical slice** (e.g. "create listing" with 6-row table) through top 2 candidates in scratch worktrees; measure your time spent, rework, and whether gates held. Throwaway code.

Also in Phase 0: one Jev probe — a 30-row listing-moderation table, measure accuracy + confidence calibration, confirm Railway auth path.

Output: recommendation — adopt X as backbone and add missing pieces (test locking hooks, traceability check, Codex steps, gate scripts) vs build own.

## Phase 1 — Written design spec
`docs/specs/2026-09-xx-agentic-framework-design.md`: pipeline stages, artifact formats (spec template, example-table grammar, traceability IDs), hooks/agents/skills layout under `.claude/`, gate scripts, Codex hand-off protocol, monorepo layout, first 3 pilot slices. User reviews → then `writing-plans`.

## Open questions for next interview rounds
- Marketplace specifics: what's sold, who are the two sides, first 3 slices?
- How will you measure the framework works? (proposed: your hours/slice, % slices merged w/o spec rework, escaped defects)
- Perf budget defaults (p95 API latency, LCP, bundle size)?
- Prod deploy: manual approval per deploy or auto after merge?
- Secrets/env management across Railway/Vercel/Supabase?
- Seed/fixture data strategy for acceptance tests?
- Journey-style scenarios (multi-step flows) — tables can't express them; accept a small step-sequence format?
- When to lift "review every PR" → spot-check (what evidence earns it)?

## Verification
- Phase 0: comparison matrix + timed trial-slice results written to `docs/research/`.
- Framework v1 considered working when 3 pilot slices ship through the full pipeline with: all gates green, zero edits by Claude to locked tests (hook log), every table row traced, and your time concentrated in stages 1/4/7.
