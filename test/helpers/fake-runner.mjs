// Test double for a project's test command. Reads tests/acceptance/rows.json (staged into the
// worktree by `wf promote`) and writes a JUnit report. A row passes if it is marked existing or
// if src/impl/<ROW-ID> exists. FAKE_NO_REPORT=1 simulates a runner without a JUnit reporter.
// Each case's classname is its file path, as vitest reports it.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

if (process.env.FAKE_NO_REPORT === '1') process.exit(1);
// runner.config.json { "excludeAcceptance": true } simulates a runner config that filters out the acceptance folder.
// src/decoys.json { rows: [{ id, title, file? }] } simulates decoy tests: always pass, reported from `file` (default src/decoys.json).
const readJson = (p, fallback) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : fallback);
const config = readJson('runner.config.json', {});
const spec = config.excludeAcceptance === true ? { rows: [] } : readJson('tests/acceptance/rows.json', { rows: [] });
const decoys = readJson('src/decoys.json', { rows: [] });
const real = spec.rows.map((r) => {
  const pass = r.existing === true || existsSync(`src/impl/${r.id}`);
  const body = pass ? '' : '<failure message="behaviour missing"/>';
  return `<testcase classname="tests/acceptance/rows.json" name="[${r.id}] ${r.title}">${body}</testcase>`;
});
const fake = decoys.rows.map((r) => `<testcase classname="${r.file ?? 'src/decoys.json'}" name="[${r.id}] ${r.title}"></testcase>`);
const cases = [...real, ...fake];
mkdirSync('reports', { recursive: true });
writeFileSync('reports/junit.xml', `<?xml version="1.0"?><testsuites><testsuite name="acceptance">${cases.join('')}</testsuite></testsuites>`);
process.exit(cases.some((c) => c.includes('<failure')) ? 1 : 0);
