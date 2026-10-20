import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(`../templates/${rel}`, import.meta.url)), 'utf8');

type Obj = Record<string, unknown>;
interface Step extends Obj {
  id?: string;
  if?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Obj;
}
interface Job extends Obj {
  needs?: string | string[];
  permissions?: Record<string, string>;
  env?: Record<string, string>;
  steps: Step[];
}
interface Workflow extends Obj {
  on: unknown;
  defaults: unknown;
  permissions: Record<string, string>;
  env: Record<string, string>;
  jobs: Record<string, Job>;
}

const REPORT = '.wf-report/junit.xml'; // relative to the job's working directory (the PR checkout)
const ARTIFACT_DIR = 'pr/.wf-report'; // the same folder relative to the workspace, for upload/download
const WORKFLOW_TEXT = read('ci/wf.yml');
const wf = parse(WORKFLOW_TEXT) as Workflow;
const jobs = Object.entries(wf.jobs);
const allSteps = jobs.flatMap(([name, job]) => job.steps.map((step) => ({ name, step })));
const stepNamed = (job: string, pred: (s: Step) => boolean): Step => {
  const found = wf.jobs[job]?.steps.find(pred);
  if (!found) throw new Error(`no matching step in ${job}`);
  return found;
};
const needsOf = (job: string): string[] => [wf.jobs[job]?.needs ?? []].flat();

/** Every string leaf in a parsed document with its dotted path. */
function leaves(node: unknown, path = ''): Array<[string, string]> {
  if (typeof node === 'string') return [[path, node]];
  if (Array.isArray(node)) return node.flatMap((v, i) => leaves(v, `${path}[${i}]`));
  if (node && typeof node === 'object') return Object.entries(node).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k));
  return [];
}

describe('ci/wf.yml', () => {
  it('triggers only on pull_request', () => {
    // Breaks if pull_request_target, push or any other trigger is added, or pull_request is dropped.
    const triggers = typeof wf.on === 'string' ? [wf.on] : Object.keys(wf.on as Obj);
    expect(triggers).toEqual(['pull_request']);
  });

  it('runs only for PRs into named base branches', () => {
    // Breaks if the `branches` filter is removed or emptied: wf would then run for PRs into any branch, including
    // an attacker-made branch carrying a bin.js that always exits 0, and its green checks could show on the head SHA.
    const branches = ((wf.on as Obj).pull_request as { branches?: string[] } | null)?.branches;
    expect(Array.isArray(branches)).toBe(true);
    expect(branches?.length ?? 0).toBeGreaterThan(0);
    for (const b of branches ?? []) expect(b).not.toMatch(/[*]/);
  });

  it('re-runs when a PR is retargeted', () => {
    // Breaks if "edited" (fires on base-branch change) or any other default activity type is dropped.
    const types = ((wf.on as Obj).pull_request as { types?: string[] } | null)?.types;
    expect([...(types ?? [])].sort()).toEqual(['edited', 'opened', 'reopened', 'synchronize']);
  });

  it('every job has a timeout (30 minutes for verify, 10 for the rest)', () => {
    // Breaks if a job loses timeout-minutes or the limits are loosened.
    for (const [name, job] of jobs) expect(job['timeout-minutes'], name).toBe(name === 'verify' ? 30 : 10);
  });

  it('token is read-only by default and only gate-check may read pull requests', () => {
    // Breaks if the top-level permissions widen, a job gains a write scope, or another job gets pull-requests.
    expect(wf.permissions).toEqual({ contents: 'read' });
    expect(wf.jobs['gate-check']?.permissions).toEqual({ contents: 'read', 'pull-requests': 'read' });
    for (const [name, job] of jobs) {
      if (name === 'gate-check') continue;
      expect(job.permissions ?? wf.permissions, name).toEqual({ contents: 'read' });
    }
    expect(JSON.stringify(wf)).not.toMatch(/"(read|write)-all"|:"write"/);
  });

  it('defines exactly the five required jobs', () => {
    expect(Object.keys(wf.jobs).sort()).toEqual(['gate-check', 'memory-check', 'stage-check', 'trace-check', 'verify']);
  });

  it('pins every uses: to a 40-hex SHA with a version comment', () => {
    // Breaks if any action is referenced by tag/branch or its trailing "# vX.Y.Z" comment is removed.
    const uses = allSteps.map(({ step }) => step.uses).filter((u): u is string => u !== undefined);
    expect(uses.length).toBeGreaterThanOrEqual(10);
    for (const u of uses) expect(u).toMatch(/^actions\/[a-z-]+@[0-9a-f]{40}$/);
    const lines = WORKFLOW_TEXT.split('\n').filter((l) => /\buses:/.test(l));
    expect(lines).toHaveLength(uses.length);
    for (const l of lines) expect(l).toMatch(/@[0-9a-f]{40} # v\d+\.\d+\.\d+\s*$/);
  });

  it('no run: script interpolates an expression', () => {
    // Breaks if any ${{ ... }} appears inside a run: string (script injection).
    const runs = allSteps.map(({ step }) => step.run).filter((r): r is string => r !== undefined);
    expect(runs.length).toBeGreaterThanOrEqual(8);
    for (const r of runs) expect(r).not.toContain('${{');
  });

  it('expressions and secrets appear only where allowlisted', () => {
    // Breaks if any ${{ }} appears outside its allowlisted path: e.g. a step-level GH_TOKEN in verify,
    // `with: token: ${{ secrets.PAT }}` on a checkout, a secret in env, or a github.token anywhere but gate-check.
    expect(WORKFLOW_TEXT).not.toContain('secrets.');
    const ALLOWED: Array<{ path: RegExp; exprs: string[] }> = [
      {
        path: /^jobs\.[^.]+\.env\.(HEAD_REF|BASE_REF|BASE_SHA|REPO)$/,
        exprs: ['github.head_ref', 'github.base_ref', 'github.event.pull_request.base.sha', 'github.repository'],
      },
      { path: /^jobs\.[^.]+\.steps\[\d+\]\.with\.ref$/, exprs: ['github.event.pull_request.base.sha'] },
      { path: /^jobs\.gate-check\.env\.GH_TOKEN$/, exprs: ['github.token'] },
      { path: /^jobs\.[^.]+\.steps\[\d+\]\.env\.CHANGE$/, exprs: ['steps.classify.outputs.change'] },
      // The canary nonce: made by verify, handed to trace-check through a job output, and only ever read through env.
      { path: /^jobs\.verify\.outputs\.nonce$/, exprs: ['steps.nonce.outputs.nonce'] },
      { path: /^jobs\.verify\.steps\[\d+\]\.env\.CANARY$/, exprs: ['steps.nonce.outputs.nonce'] },
      { path: /^jobs\.trace-check\.steps\[\d+\]\.env\.CANARY$/, exprs: ['needs.verify.outputs.nonce'] },
    ];
    let seen = 0;
    for (const [path, value] of leaves(wf)) {
      for (const m of value.matchAll(/\$\{\{\s*(.*?)\s*\}\}/g)) {
        seen += 1;
        const expr = m[1] ?? '';
        const ok = ALLOWED.some((a) => a.path.test(path) && a.exprs.includes(expr));
        expect(ok, `${path}: ${expr}`).toBe(true);
      }
    }
    // Expressions hiding in keys or anywhere the leaf walk misses would make the counts differ.
    expect(WORKFLOW_TEXT.split('${{').length - 1).toBe(seen);
    expect(seen).toBeGreaterThan(0);
  });

  it('untrusted refs enter only through env and are quoted in scripts', () => {
    // Breaks if HEAD_REF/BASE_REF/BASE_SHA/REPO are renamed, sourced differently, or used unquoted.
    for (const [name, job] of jobs) {
      expect(job.env, name).toMatchObject({
        HEAD_REF: '${{ github.head_ref }}',
        BASE_REF: '${{ github.base_ref }}',
        BASE_SHA: '${{ github.event.pull_request.base.sha }}',
        REPO: '${{ github.repository }}',
      });
    }
    for (const { name, step } of allSteps) {
      for (const v of ['HEAD_REF', 'BASE_REF', 'BASE_SHA', 'REPO', 'CHANGE']) {
        for (const m of (step.run ?? '').matchAll(new RegExp(`(.)\\$\\{?${v}\\b`, 'g'))) {
          expect(m[1], `${name}: unquoted $${v}`).toBe('"');
        }
      }
    }
  });

  it('every checkout sets persist-credentials: false and the PR checkout is full-depth', () => {
    // Breaks if persist-credentials is removed/true, or fetch-depth 0 is dropped from the PR checkout.
    for (const [name, job] of jobs) {
      const checkouts = job.steps.filter((s) => s.uses?.startsWith('actions/checkout@'));
      expect(checkouts, name).toHaveLength(2);
      for (const c of checkouts) expect(c.with?.['persist-credentials'], name).toBe(false);
      const [pr, trusted] = checkouts;
      expect(pr?.with?.path, name).toBe('pr');
      expect(pr?.with?.['fetch-depth'], name).toBe(0);
      expect(pr?.with?.ref, name).toBeUndefined();
      expect(trusted?.with?.ref, name).toBe('${{ github.event.pull_request.base.sha }}');
      expect(trusted?.with?.path, name).toBe('trusted');
    }
    const depthLines = WORKFLOW_TEXT.split('\n').filter((l) => l.includes('fetch-depth'));
    expect(depthLines).toHaveLength(jobs.length);
    // The comment must give the real reason: provenance (shallow clones) for gate-check, the classify merge-base
    // for the jobs that run classify; memory-check's checkout is only kept uniform.
    const reasons: Record<string, RegExp> = {
      'gate-check': /shallow/i,
      'memory-check': /memory-check itself reads no git history/,
      'stage-check': /classify.*merge-base/,
      verify: /classify.*merge-base/,
      'trace-check': /classify.*merge-base/,
    };
    jobs.forEach(([name], i) => expect(depthLines[i], name).toMatch(reasons[name] ?? /^$/));
  });

  it('wf runs from a trusted checkout that is a sibling of the PR checkout, never inside it', () => {
    // Breaks if WF points into the PR tree (or a path under it), if the trusted checkout moves inside the PR
    // checkout (bare imports would then resolve through the PR's node_modules and vitest would find its tests),
    // if the working directory is not the PR checkout, or if a step runs node/npx/a workspace path directly.
    expect(wf.defaults).toEqual({ run: { 'working-directory': 'pr' } });
    const match = /^node (\S+)$/.exec(wf.env.WF ?? '');
    expect(match).not.toBeNull();
    const target = posix.normalize(posix.join('pr', match?.[1] ?? ''));
    expect(target.startsWith('trusted/'), `WF resolves to ${target}`).toBe(true);
    expect(target.startsWith('pr/')).toBe(false);
    expect(Object.keys(wf.env)).toEqual(['WF']);
    for (const [name, job] of jobs) {
      const [prDir, trustedDir] = job.steps.filter((s) => s.uses?.startsWith('actions/checkout@')).map((s) => String(s.with?.path));
      expect(prDir, name).toBe('pr');
      expect(trustedDir, name).toBe('trusted');
      expect(trustedDir?.startsWith(`${prDir}/`), name).toBe(false);
      const runs = job.steps.map((s) => s.run ?? '').filter((r) => r !== '');
      expect(runs.some((r) => r.includes('$WF ')), name).toBe(true);
      for (const r of runs) {
        expect(r, name).not.toMatch(/(^|[\s;&|])(node|npx|npm|bash|sh)\s/);
        expect(r, name).not.toMatch(/dist\/bin\.js|\.workflow\/|\.\/wf/);
      }
    }
    expect(WORKFLOW_TEXT).toMatch(/self-contained bundle/);
    expect(WORKFLOW_TEXT.split('\n').slice(0, 12).join('\n')).toMatch(/CODEOWNERS review of \/\.github\//);
  });

  it('verify needs stage-check and trace-check needs verify', () => {
    expect(needsOf('verify')).toContain('stage-check');
    expect(needsOf('trace-check')).toContain('verify');
    expect(needsOf('gate-check')).toEqual([]);
    expect(needsOf('memory-check')).toEqual([]);
  });

  it('gate-check passes the base commit and base branch to pr-check with a token', () => {
    expect(wf.jobs['gate-check']?.env?.GH_TOKEN).toBe('${{ github.token }}');
    const run = stepNamed('gate-check', (s) => s.run?.includes('pr-check') === true).run;
    expect(run).toBe('$WF pr-check --base "$BASE_SHA" --base-branch "$BASE_REF" --branch "$HEAD_REF" --repo "$REPO"');
    for (const [name, job] of jobs) {
      if (name !== 'gate-check') expect(job.env?.GH_TOKEN, name).toBeUndefined();
    }
  });

  it('memory-check runs wf memory-check', () => {
    expect(stepNamed('memory-check', (s) => s.run?.includes('memory-check') === true).run).toBe('$WF memory-check');
  });

  it('stage-check, verify and trace-check classify first and fail on a malformed PR', () => {
    // Breaks if classify is dropped, loses its id, stops writing GITHUB_OUTPUT or gains continue-on-error.
    for (const job of ['stage-check', 'verify', 'trace-check']) {
      const classify = stepNamed(job, (s) => s.id === 'classify');
      expect(classify.run, job).toBe('$WF classify --base "$BASE_SHA" --branch "$HEAD_REF" >> "$GITHUB_OUTPUT"');
      expect(classify['continue-on-error'], job).toBeUndefined();
    }
    expect(JSON.stringify(wf)).not.toContain('continue-on-error');
  });

  it('stage-check and trace-check act only for kind == change, with CHANGE from env', () => {
    const gate = "steps.classify.outputs.kind == 'change'";
    const stage = stepNamed('stage-check', (s) => s.run?.includes('stage-check') === true);
    expect(stage.if).toBe(gate);
    expect(stage.env).toEqual({ CHANGE: '${{ steps.classify.outputs.change }}' });
    expect(stage.run).toBe('$WF stage-check "$CHANGE"');
    const trace = stepNamed('trace-check', (s) => s.run?.includes('trace-check') === true);
    expect(trace.if).toBe(gate);
    // Breaks if --canary is dropped: trace-check would then accept a report in which the must-fail canary never ran.
    expect(trace.env).toEqual({ CHANGE: '${{ steps.classify.outputs.change }}', CANARY: '${{ needs.verify.outputs.nonce }}' });
    expect(trace.run).toBe(`$WF trace-check "$CHANGE" --report ${REPORT} --canary "$CANARY"`);
  });

  it('verify always runs the tests and uploads the report only on success', () => {
    // Breaks if the run step becomes conditional, the report path drifts, or the upload gains an if (e.g. always()).
    const tests = stepNamed('verify', (s) => s.run?.includes('run-tests') === true);
    // Breaks if --base is dropped: the PR's own config would then choose the command that vouches for it.
    // Breaks if --isolate is dropped: PR code would run on the runner, where a process can outlive the step and
    // rewrite the report. Breaks if --canary is dropped: nothing would show the tests ran with assertions on.
    expect(tests.run).toBe(`$WF run-tests --base "$BASE_SHA" --isolate --canary "$CANARY" --report-out ${REPORT}`);
    expect(tests.env).toEqual({ CANARY: '${{ steps.nonce.outputs.nonce }}' });
    expect(tests.if).toBeUndefined();
    const upload = stepNamed('verify', (s) => s.uses?.startsWith('actions/upload-artifact@') === true);
    expect(upload.if).toBeUndefined();
    expect(upload.with).toMatchObject({ name: 'junit-report', path: `pr/${REPORT}` });
    // Breaks if include-hidden-files is removed or false: the report is in the dot-directory .wf-report, which
    // upload-artifact (v4.4+, default false) silently skips, leaving trace-check nothing to download.
    expect(upload.with?.['include-hidden-files']).toBe(true);
    // Breaks if if-no-files-found is removed (default is warn) or set to warn/ignore: a missing report would pass.
    expect(upload.with?.['if-no-files-found']).toBe('error');
    for (const { step } of allSteps) expect(step.if ?? '').not.toMatch(/always|failure|cancelled/);
    const order = wf.jobs.verify?.steps ?? [];
    expect(order.indexOf(upload)).toBeGreaterThan(order.indexOf(tests));
  });

  it('verify makes a fresh random nonce before the tests and hands it to trace-check', () => {
    const nonce = stepNamed('verify', (s) => s.id === 'nonce');
    expect(nonce.run).toBe('echo "nonce=$(openssl rand -hex 16)" >> "$GITHUB_OUTPUT"');
    expect(nonce.if).toBeUndefined();
    const order = wf.jobs.verify?.steps ?? [];
    const tests = stepNamed('verify', (s) => s.run?.includes('run-tests') === true);
    expect(order.indexOf(nonce)).toBeLessThan(order.indexOf(tests));
    expect(wf.jobs.verify?.outputs).toEqual({ nonce: '${{ steps.nonce.outputs.nonce }}' });
    expect(needsOf('trace-check')).toContain('verify');
  });

  it('trace-check downloads the junit-report artifact into the PR checkout .wf-report', () => {
    const dl = stepNamed('trace-check', (s) => s.uses?.startsWith('actions/download-artifact@') === true);
    expect(dl.if).toBe("steps.classify.outputs.kind == 'change'");
    expect(dl.with).toMatchObject({ name: 'junit-report', path: ARTIFACT_DIR });
  });

  it('every job runs on ubuntu-latest with node 24 and no npm cache', () => {
    for (const [name, job] of jobs) {
      expect(job['runs-on'], name).toBe('ubuntu-latest');
      const node = job.steps.find((s) => s.uses?.startsWith('actions/setup-node@'));
      expect(node?.with?.['node-version'], name).toBe(24);
      // Breaks if npm caching (auto-enabled by setup-node from the PR-controlled package.json) is turned back on.
      expect(node?.with?.['package-manager-cache'], name).toBe(false);
    }
  });
});

describe('CODEOWNERS', () => {
  // Mirrors the spec's Trust boundary list (docs/specs/2026-09-29-agentic-workflow-design.md) plus D5 staging folders.
  const PROTECTED = [
    '/tests/acceptance/',
    '/tests/harness/',
    '/vitest.config.*',
    '/.workflow/',
    '/.github/',
    '/workflow.config.json',
    '/AGENTS.md',
    '/CLAUDE.md',
    '/roles/',
    '/docs/specs/',
    '/docs/decisions/',
    '/docs/changes/*/approvals/',
    '/docs/changes/*/baseline.json',
    '/docs/changes/*/design/',
    '/docs/changes/*/tests/',
  ];
  const rules = read('CODEOWNERS')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'))
    .map((l) => l.split(/\s+/));

  it('names every protected path', () => {
    // Breaks if a protected path is removed, renamed, or an unexpected one is added silently.
    expect(rules.map(([p]) => p)).toEqual(PROTECTED);
  });

  it('owns every line with @APPROVER and nobody else', () => {
    // Breaks if a line has a different or extra owner, or no owner (which un-protects the path).
    for (const [path, ...owners] of rules) expect(owners, path).toEqual(['@APPROVER']);
  });
});

describe('ruleset.json', () => {
  interface Rule {
    type: string;
    parameters?: Obj;
  }
  const rs = JSON.parse(read('ruleset.json')) as {
    name: string;
    target: string;
    enforcement: string;
    bypass_actors: unknown[];
    conditions: { ref_name: { include: string[]; exclude?: string[] } };
    rules: Rule[];
  };
  const rule = (type: string): Rule => {
    const r = rs.rules.find((x) => x.type === type);
    if (!r) throw new Error(`missing rule ${type}`);
    return r;
  };

  it('is an active, bypass-free ruleset on the default branch', () => {
    expect(rs).toMatchObject({ name: 'protect-main', target: 'branch', enforcement: 'active', bypass_actors: [] });
    expect(rs.conditions.ref_name.include).toEqual(['~DEFAULT_BRANCH']);
    expect(rs.conditions.ref_name.exclude ?? []).toEqual([]);
  });

  it('requires code-owner review, an approving review, linear history, rebase only and the five checks', () => {
    // Breaks if any listed rule or parameter is removed or loosened.
    for (const t of ['deletion', 'non_fast_forward', 'required_linear_history']) rule(t);
    expect(rule('pull_request').parameters).toMatchObject({
      allowed_merge_methods: ['rebase'],
      required_approving_review_count: 1,
      require_code_owner_review: true,
      dismiss_stale_reviews_on_push: true,
      require_last_push_approval: true,
      required_review_thread_resolution: true,
    });
    const checks = rule('required_status_checks').parameters as {
      strict_required_status_checks_policy: boolean;
      required_status_checks: Array<{ context: string; integration_id: number }>;
    };
    expect(checks.strict_required_status_checks_policy).toBe(true);
    expect(checks.required_status_checks.map((c) => c.context).sort()).toEqual([
      'gate-check',
      'memory-check',
      'stage-check',
      'trace-check',
      'verify',
    ]);
    for (const c of checks.required_status_checks) expect(c.integration_id, c.context).toBe(15368);
  });

  it('required check names equal the workflow job names', () => {
    // Breaks if a job is renamed in wf.yml without updating the ruleset (checks would never report).
    const checks = rule('required_status_checks').parameters as { required_status_checks: Array<{ context: string }> };
    expect(checks.required_status_checks.map((c) => c.context).sort()).toEqual(Object.keys(wf.jobs).sort());
  });
});
