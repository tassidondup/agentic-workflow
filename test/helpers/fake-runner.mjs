// Test double for a project's test command. Reads tests/acceptance/rows.json (staged into the
// worktree by `wf promote`) and writes a JUnit report. A row passes if it is marked existing or
// if src/impl/<ROW-ID> exists. FAKE_NO_REPORT=1 simulates a runner without a JUnit reporter.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

if (process.env.FAKE_NO_REPORT === '1') process.exit(1);
const spec = existsSync('tests/acceptance/rows.json')
  ? JSON.parse(readFileSync('tests/acceptance/rows.json', 'utf8'))
  : { rows: [] };
const cases = spec.rows.map((r) => {
  const pass = r.existing === true || existsSync(`src/impl/${r.id}`);
  const body = pass ? '' : '<failure message="behaviour missing"/>';
  return `<testcase classname="acceptance" name="[${r.id}] ${r.title}">${body}</testcase>`;
});
mkdirSync('reports', { recursive: true });
writeFileSync('reports/junit.xml', `<?xml version="1.0"?><testsuites><testsuite name="acceptance">${cases.join('')}</testsuite></testsuites>`);
process.exit(cases.some((c) => c.includes('<failure')) ? 1 : 0);
