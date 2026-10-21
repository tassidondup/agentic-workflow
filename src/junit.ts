import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { isObject } from './guards.js';

export interface TestCase {
  readonly name: string;
  readonly classname: string;
  readonly file: string;
  readonly status: 'passed' | 'failed' | 'skipped';
  readonly rowIds: readonly string[];
}

const TAG = /\[([A-Z][A-Z0-9]{1,9}-\d{1,4})\]/g;
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  processEntities: false,
  isArray: (name) => name === 'testsuite' || name === 'testcase' || name === 'testsuites',
});

/** Row tags like `[LST-004]` found in any text, in order of appearance (may repeat). */
export const rowTags = (text: string): string[] => [...text.matchAll(TAG)].map((m) => m[1] ?? '');

function toCase(node: unknown): TestCase {
  const tc = isObject(node) ? node : {};
  const name = String(tc['@_name'] ?? '');
  const classname = String(tc['@_classname'] ?? '');
  const status = 'failure' in tc || 'error' in tc ? 'failed' : 'skipped' in tc ? 'skipped' : 'passed';
  const file = String(tc['@_file'] ?? classname);
  return Object.freeze({ name, classname, file, status, rowIds: Object.freeze([...new Set([...rowTags(name), ...rowTags(classname)])]) });
}

function collect(node: unknown): TestCase[] {
  if (!isObject(node)) return [];
  const cases = Array.isArray(node.testcase) ? node.testcase.map(toCase) : [];
  const nested = ['testsuites', 'testsuite'].flatMap((k) => (Array.isArray(node[k]) ? (node[k] as unknown[]).flatMap(collect) : []));
  return [...nested, ...cases];
}

export function parseJUnit(xml: string): TestCase[] {
  const valid = XMLValidator.validate(xml);
  if (valid !== true) throw new Error(`Invalid JUnit XML: ${valid.err.msg} (line ${valid.err.line})`);
  const doc: unknown = parser.parse(xml);
  if (!isObject(doc) || !('testsuites' in doc || 'testsuite' in doc)) {
    throw new Error('The report has no <testsuite> elements; is the JUnit reporter configured?');
  }
  return collect(doc);
}

const countOf = (value: unknown): number => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : 0;
};

function hiddenIn(node: unknown, label: string): string[] {
  if (!isObject(node)) return [];
  const children = ['testsuites', 'testsuite'].flatMap((k) => (Array.isArray(node[k]) ? (node[k] as unknown[]) : []));
  const problems: string[] = [];
  if ('failure' in node || 'error' in node) problems.push(`${label} reports an error outside any test case`);
  const declared = countOf(node['@_failures']) + countOf(node['@_errors']);
  const listed = collect(node).filter((c) => c.status === 'failed').length;
  if (declared > listed) problems.push(`${label} declares ${declared} failure or error, but its report lists ${listed} failed tests`);
  return [...problems, ...children.flatMap((c, i) => hiddenIn(c, isObject(c) && c['@_name'] !== undefined ? `suite "${String(c['@_name'])}"` : `suite #${i + 1}`))];
}

/**
 * Failures a report states but does not attach to a test case: a suite-level error (a file that failed to load), or
 * a count of failures or errors larger than the failed cases listed under it. A suite that counts its children's
 * failures too is fine, since its listed cases include theirs. Needed where the exit status cannot be trusted to fail
 * the run (the canary run always exits non-zero).
 */
export function hiddenFailures(xml: string): string[] {
  const doc: unknown = parser.parse(xml);
  if (!isObject(doc)) return [];
  const roots = ['testsuites', 'testsuite'].flatMap((k) => (Array.isArray(doc[k]) ? (doc[k] as unknown[]) : []));
  return roots.flatMap((r) => hiddenIn(r, isObject(r) && r['@_name'] !== undefined ? `suite "${String(r['@_name'])}"` : 'the report'));
}
