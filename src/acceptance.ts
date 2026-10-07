import { isAbsolute, posix } from 'node:path';
import type { TestCase } from './junit.js';
import { isUnderPath } from './paths.js';

export interface ScopedCases {
  readonly cases: readonly TestCase[];
  readonly problems: readonly string[];
}

/** Repo-relative path of the file a JUnit test case came from, or null if the report gives none usable. */
export function caseFile(root: string, file: string): string | null {
  let f = file.trim().replaceAll('\\', '/');
  if (f === '') return null;
  if (isAbsolute(f)) {
    const base = `${root.replaceAll('\\', '/')}/`;
    if (!f.startsWith(base)) return null;
    f = f.slice(base.length);
  }
  const n = posix.normalize(f);
  return n === '.' || n === '..' || n.startsWith('../') || n.startsWith('/') ? null : n;
}

/** Keeps only test cases whose file is under the acceptance folder (ADR 0001). A row-tagged case with no usable file is a problem. */
export function acceptanceCases(root: string, dir: string, cases: readonly TestCase[]): ScopedCases {
  const problems = cases
    .filter((c) => c.rowIds.length > 0 && caseFile(root, c.file) === null)
    .map((c) => `Test "${c.name}" has no usable file path in the JUnit report (file="${c.file}"); configure the reporter to record each test's file`);
  const kept = cases.filter((c) => {
    const f = caseFile(root, c.file);
    return f !== null && isUnderPath(dir, f);
  });
  return Object.freeze({ cases: Object.freeze(kept), problems: Object.freeze(problems) });
}
