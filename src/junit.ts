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
