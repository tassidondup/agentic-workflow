# GitHub setup

How to make the `wf` gates enforceable on GitHub: a bot identity for agents, CODEOWNERS, the CI workflow and the `protect-main` ruleset. Design: `docs/specs/2026-09-29-agentic-workflow-design.md` (v2.7), sections *Gates and approval records* and *Trust boundary*.

Status: **the live verification (section 7) has NOT YET RUN.** Everything below about how `wf` behaves comes from the code and its tests; the workflow has never run on GitHub.

Every GitHub fact is marked *verified* (with source and date) or *unverified*. GitHub changes often; re-check before relying on one.

## 1. Requirements
- A **public** repo, or a private repo on GitHub Pro (personal) or Team (organization). *Verified 2026-10-07: the rulesets API refuses a private repo on the free plan.*
- `gh` CLI, logged in as a repo admin, for creating the ruleset.
- Node 24 on the runner (the workflow installs it with `actions/setup-node`).

## 2. Bot identity
Agents push branches and open PRs as a **separate GitHub account** (the bot). You approve and merge as yourself. Provenance (section 5) rests on that split: if agents hold your token, provenance proves nothing.

**Why a token, not `GITHUB_TOKEN`.** Events caused by `GITHUB_TOKEN` (for example a push from a workflow) do not start new workflow runs, except `workflow_dispatch` and `repository_dispatch`; a personal access token or GitHub App token does. So a branch pushed with `GITHUB_TOKEN` would get no `wf` checks. *Verified 2026-10-19: docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow, "Triggering a workflow from a workflow".*

**Fine-grained tokens don't work for a collaborator on a personal repo.** GitHub lists, as a gap of fine-grained tokens, using one "to contribute to repositories where the user is an outside or repository collaborator". A fine-grained token is limited to resources owned by one user or organization, and the bot doesn't own your repo. *Verified 2026-10-19: docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens, "Fine-grained personal access tokens limitations".* Pick one of these:

**Option A, repo in an organization (least privilege).** Put the repo in a GitHub organization (free is fine for a public repo). Make the bot an org member with the **Write** role on this repo only. Create a fine-grained token on the bot account, resource owner = the organization, repository access = this repo only, with:

| Permission | Access | Why |
|---|---|---|
| Contents | Read and write | push branches (git refs, commits) |
| Pull requests | Read and write | open PRs, PR review comments |
| Issues | Read and write | optional: only if agents comment on the PR conversation (see below) |
| Metadata | Read | read-only repo metadata; *unverified* whether GitHub adds it automatically |
| **Workflows** | **No access** | would let the bot change `.github/workflows/**` |
| **Administration** | **No access** | settings, rulesets, branch protection, collaborators |
| **Actions** | **No access** | re-run, cancel, dispatch workflows; read logs and artifacts |
| **Secrets** | **No access** | Actions secrets |

*Verified 2026-10-19 against docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens:* `POST /repos/{owner}/{repo}/pulls` needs Pull requests (write); `POST .../git/refs` and `PATCH .../git/refs/{ref}` need Contents (write); `POST .../issues/{n}/comments` is listed under both Issues (write) and Pull requests (write), so *unverified* whether Pull requests alone is enough to comment on a PR; review comments (`POST .../pulls/{n}/comments`) need Pull requests (write). The page has no entry for `git push` itself; that Contents write covers a push over HTTPS is *unverified*. *Unverified:* whether your organization requires admin approval of fine-grained tokens (an org setting).

**Option B, personal repo with a classic token.** Invite the bot as a collaborator (it gets write access). Create a **classic** token on the bot account with `public_repo` (public repo) or `repo` (private repo) and **without the `workflow` scope**. Without `workflow` the token cannot add or update workflow files, unless an identical file already exists on another branch. *Verified 2026-10-19: docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps.* The limits come from the bot's collaborator role, not the token: keep the bot a collaborator on this repo only. A classic token cannot drop Actions or Secrets rights the role has (*unverified for personal-repo collaborators; on organization repos the Write role can create Actions secrets and re-run workflows, verified 2026-10-19 at docs.github.com/en/organizations/managing-user-access-to-your-organizations-repositories/managing-repository-roles/repository-roles-for-an-organization*).

A GitHub App installation token is a third route; it is not designed or checked here.

**What the bot can still do, either option.** Merging a PR through the API needs only Contents (write) (*verified 2026-10-19, same permissions page*), which the bot needs to push. So the bot cannot merge a PR the ruleset blocks, but **can merge a PR after you approve it**. For approval records, provenance rejects that (the record must be merged by an approver). For other PRs nothing in the templates stops it, so merge yourself right after approving. See *Known limits* in the design doc.

Store the token where only the agents' runtime reads it (for example `GH_TOKEN` in the agent session's environment). Never commit it, never put it in a repo secret, and never paste it into a prompt.

## 3. Install
Until the installer exists (Plan 3), by hand:
1. Copy `templates/CODEOWNERS` to `.github/CODEOWNERS`. Replace every `@APPROVER` with your login (or each approver's). Add a line for each runner config in `workflow.config.json → test.harness` other than `vitest.config.*`. Code owners need explicit write access to the repo. *Verified 2026-10-19: docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners.* The template doesn't protect `package.json` test scripts or lockfiles; see *Known limits* in the design doc.
2. Copy `templates/ci/wf.yml` to `.github/workflows/wf.yml`. Replace `main` in its `on.pull_request.branches` filter with the repo's default branch (the installer must do this too). `wf` must only run for PRs into a protected branch, because `trusted/` is that base's commit; without the filter, a PR into an attacker-made branch carrying a `bin.js` that always exits 0 would get green checks with the required names on its head SHA. *Unverified:* whether such a green run could override the failing run on the real PR into main; required checks are tied to the commit SHA, so don't rely on it.
3. Put a self-contained `wf` bundle at `.workflow/wf/bin.js` (the path in the workflow's `WF` variable). It must resolve nothing from `node_modules`. **There is no way to make one yet.** This repo's `dist/` is NOT a bundle: `npm run build` is plain `tsc`, and `dist/junit.js` imports `fast-xml-parser`. Producing the bundle is the Plan 3 installer's job. See *Until Plan 3* below.
4. Make sure `workflow.config.json` lists your login in `approvers`.
5. Open this as one PR (the **install PR**) and merge it. See section 4 before creating the ruleset.
6. Create the ruleset:
   ```bash
   gh api -X POST repos/OWNER/REPO/rulesets --input templates/ruleset.json
   ```
   It targets the default branch: PR required, rebase merges only, linear history, no deletion or force push, no bypass, one approving review, code-owner review, stale approvals dismissed on push, last push must be approved by someone else, threads resolved, and the five checks `gate-check`, `stage-check`, `verify`, `trace-check`, `memory-check` required and up to date. `integration_id: 15368` is the GitHub Actions app (*verified 2026-10-18 from this repo's `protect-main`*).

**No other workflow may define jobs named `gate-check`, `stage-check`, `verify`, `trace-check` or `memory-check`.** Required checks match by name, so a job with one of those names on the same SHA could satisfy the requirement.

**Keep all five checks required.** `verify` needs `stage-check` and `trace-check` needs `verify`. A job skipped because the job it needs failed "will report its status as Success" and "will not prevent a pull request from merging, even if it is a required check" (*verified 2026-10-19: docs.github.com/en/pull-requests/reference/status-checks*). The PR is still blocked only because the failed job is itself required. The same applies to steps the workflow skips on purpose: `stage-check` and `trace-check` only do real work on implementation PRs and pass on gate and `other` PRs.

GitHub reads CODEOWNERS from the PR's **base** branch (*verified 2026-10-19, about-code-owners page*), so the install PR is not yet protected by the file it adds.

**Until Plan 3.** The trusted-checkout guarantee (section 5, D3) can't be met by hand today. Copying `dist/` to `.workflow/wf/` doesn't work. Tested locally on 2026-10-19: a copy in `trusted/.workflow/wf/`, run from a sibling `pr/` as CI does, fails on load with `ERR_MODULE_NOT_FOUND` for `fast-xml-parser`, even for `--help`. That holds even with the package in `pr/node_modules`, because Node looks only in the folders above `trusted/`. Any workaround that lets `wf` load its dependencies from files the PR controls brings back the hole D3 closes. For someone installing now:
- CODEOWNERS and the ruleset's `pull_request` rules work without `wf`. Install them, but leave out the `required_status_checks` rule.
- Without a bundle the workflow fails `gate-check`, `memory-check` and `stage-check` on every PR (`verify` and `trace-check` are skipped). If those checks were required, nothing could merge. Add the rule once a real bundle is on the default branch.
- `wf` still works locally (`npm run build`, then `node dist/bin.js …` in this repo), but nothing in CI enforces the gates.
- The live verification (section 7) needs a bundle too. A bundle made by hand for it is untested here; record how it was made.

## 4. Bootstrap
Every job runs `node ../trusted/.workflow/wf/bin.js`, where `trusted/` is a checkout of the PR's base commit. On the install PR the base has no `.workflow/wf/bin.js`, so `gate-check`, `memory-check` and `stage-check` fail. `verify` and `trace-check` are skipped because the job they need failed, and skipped jobs report success (see *Keep all five checks required*). That is expected. So:
1. Merge the install PR before the five checks are required (create the ruleset afterwards, or first create it without the `required_status_checks` rule and add that rule after the merge).
2. From the next PR on, `wf` runs from the base and the checks mean something.

Approvers come from `workflow.config.json` **at the base commit**, never from the PR (a PR can't add itself or the bot to the list that vouches for its records). A design or tests gate PR, or an implementation PR, whose base has no usable `workflow.config.json` fails `gate-check` with "workflow.config.json is not on <base>; approvers must come from the base branch". After the install PR is merged the base has it. To add an approver, merge a PR changing `approvers` first; it counts from the next PR.

## 5. What provenance guarantees, and what it doesn't
`wf pr-check` (the `gate-check` job) decides what kind of PR this is from its diff, then checks it.

**PR kind (D4).**
- **Gate PR:** adds or changes (git status A, M or T) a file `docs/changes/<id>/approvals/<spec|design|tests>.json`. It must hold exactly one record, and every changed path, including deletions, must be under `docs/changes/<id>/`. A head branch `change/<other-id>` is refused. This closes the ADR 0001 attack where a tests-gate PR also edits the runner config.
- **Implementation PR:** no record, head branch `change/<id>` with a valid id.
- **Other:** anything else. **`wf` checks nothing on it**, with one exception: a head branch `change/<invalid-id>` (for example `change/Bad_ID`) is classified `other` with a problem, and `classify` and `pr-check` fail. Only CODEOWNERS and the ruleset protect it. An agent can name an implementation branch anything and get `other`; your review of protected paths is the backstop. A P0 lane that closes this is out of scope for now.

**Provenance (D1).** For each record the PR relies on (the prerequisites of a gate PR's gate; all three for an implementation PR), CI requires:
1. the record is on the base commit and unchanged in this PR;
2. the last commit that touched it on the base belongs to exactly one PR merged into the base branch;
3. that PR was merged by an approver; and
4. either the PR's author is an approver, or an approver's latest deciding review (`APPROVED`, `CHANGES_REQUESTED` or `DISMISSED`) is `APPROVED` on the PR's final head commit.

Logins compare case-insensitively. Any git or GitHub error, odd response, or ambiguity fails the check. A shallow checkout fails it too (the history can't be trusted), so the workflow fetches full history (`fetch-depth: 0`).

In plain words: a record counts only if one of your accounts merged its PR, and either you wrote it or you approved its last commit. **If agents hold your own token, provenance proves nothing**: the "author is an approver" branch accepts any PR opened and merged by your account.

**What runs `wf` (D3).** CI checks out the PR into `pr/` and the PR's base commit into `trusted/`, side by side, and runs `wf` from `trusted/` with `pr/` as the working directory. So a PR can't edit the code that judges it. Two conditions:
- `bin.js` must be a self-contained bundle. With the sibling layout, an unbundled `wf` doesn't load the PR's `node_modules`; it fails to load at all (section 3, *Until Plan 3*). Making it load by installing dependencies where the PR's code can write them would let the PR change its judge. The installer (Plan 3) must ship a bundle; `dist/` is not one.
- Under `pull_request`, GitHub runs the workflow file from the PR's merge commit, not from the base. A PR can edit `wf.yml` to skip the checks. Only the CODEOWNERS review of `/.github/` stops that, so review every workflow change.

**Staging folders (D5).** `docs/changes/*/design/` and `docs/changes/*/tests/` are always code-owned. CODEOWNERS can't say "only once approved".

**Deleting a record (D6)** is not a gate PR. Archiving a change deletes its records, and that flow isn't designed yet (Plan 4). Record deletions are code-owned and otherwise unchecked.

**Not covered by provenance.** A `CHANGES_REQUESTED` from one approver does not cancel another approver's approval. Who merges an implementation or `other` PR is not checked.

## 6. Solo developer: the review-count conflict
GitHub does not let an author approve their own PR (*verified 2026-10-19: docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/approving-a-pull-request-with-required-reviews, "Pull request authors cannot approve their own pull requests"*). The shipped ruleset requires one approving review and code-owner review. So with one human approver, **a PR you author can never merge**.

**Solo with a bot (recommended).** The bot opens every PR, approval-record PRs included; you approve and merge. Changes you want to make yourself go through the bot too. Note `require_last_push_approval`: if you push a fix onto the bot's branch, you can't approve that push; ask the bot to push it instead. Provenance then rests on the review branch of rule 4 (your approval on the final commit), the stronger one.

**Solo without a bot (weaker).** Edit the `pull_request` parameters before creating the ruleset:
```json
"required_approving_review_count": 0,
"require_code_owner_review": false,
"dismiss_stale_reviews_on_push": false,
"require_last_push_approval": false
```
Keep the same five checks. This matches this framework's own `protect-main` (*verified 2026-10-19 with `gh api repos/{owner}/{repo}/rulesets/<id>`*). *Unverified:* whether `require_code_owner_review: true` with a count of 0 still blocks a sole-owner author; turning it off avoids the question.

What you lose: GitHub enforces no human review at all. Anyone with write access can merge a green PR. Agents use your account, so provenance shows only that your account merged the record, which agents also control. The hashes, the gate chain and the CI checks still hold; your approval is no longer proven.

## 7. Live verification (NOT YET RUN)
Needs the bot account and a scratch repo. Nothing here has been done yet; tick each box when it is, and record what you saw.

Setup:
- [ ] Scratch repo (public), installed as in section 3 with a `wf` bundle (record how it was made), install PR merged, ruleset created.
- [ ] Bot account with a token per section 2 (note which option).

Approval record by the bot, approved and merged by you:
- [ ] Bot pushes a branch and opens a PR adding a spec record (`wf approve <id> spec`). Checks run on the bot's push.
- [ ] You approve on the final commit and merge.
- [ ] On a follow-up branch with a design record, run `wf pr-check --base <base sha> --base-branch main --branch <branch> --repo OWNER/REPO` with a real `GH_TOKEN` (read-only is enough). Expect exit 0.
- [ ] Record the observed review `state` values from `gh api repos/OWNER/REPO/pulls/<n>/reviews` (expected `APPROVED`; the docs don't list them). Weak hint, not verification: on 2026-10-19 `gh api repos/cli/cli/pulls/<n>/reviews` on public cli/cli PRs returned `APPROVED` and `COMMENTED`, with `commit_id` and `submitted_at` set.

Bot merge:
- [ ] Bot tries to merge an approval-record PR before your approval. Expect the ruleset to refuse.
- [ ] You approve, the bot merges. Expect GitHub to accept, and `pr-check` on a follow-up PR to fail with "PR #n was merged by <bot>, who is not an approver".

Workflow:
- [ ] The five jobs run and report under the exact names the ruleset requires.
- [ ] A tests-gate PR that also edits `vitest.config.ts` fails `gate-check` and `stage-check` (both report the scope problem). `verify` and `trace-check` are skipped (reported as success).
- [ ] `verify` uploads `junit-report` and `trace-check` reads it.
- [ ] A PR into an unprotected branch produces no wf checks, and reopening it does not turn the main PR green.
- [ ] Base advances after the PR is opened, then the bot pushes again; confirm `classify` and `pr-check` still use the right diff (merge ref vs `pull_request.base.sha`).

Results: (fill in date, repo, outcomes, review states seen)
