import { describe, expect, it } from 'vitest';
import { acceptanceCases, caseFile } from '../src/acceptance.js';
import type { TestCase } from '../src/junit.js';

const ROOT = '/work/repo';
const tc = (file: string, rowIds: string[] = ['LST-001']): TestCase =>
  ({ name: `${rowIds.map((r) => `[${r}]`).join('')} t`, classname: file, file, status: 'passed', rowIds });

describe('caseFile (Review Focus 1)', () => {
  it.each([
    ['tests/acceptance/a.test.ts', 'tests/acceptance/a.test.ts'],
    ['./tests/acceptance/a.test.ts', 'tests/acceptance/a.test.ts'],
    ['tests\\acceptance\\a.test.ts', 'tests/acceptance/a.test.ts'],
    ['/work/repo/tests/acceptance/a.test.ts', 'tests/acceptance/a.test.ts'],
    ['tests/acceptance/../../src/decoy.test.ts', 'src/decoy.test.ts'],
  ])('normalizes %j to %j', (raw, want) => {
    expect(caseFile(ROOT, raw)).toBe(want);
  });
  it.each(['', '   ', '/elsewhere/tests/acceptance/a.test.ts', '/work/repo-evil/tests/acceptance/a.test.ts', '../outside.test.ts'])(
    'rejects %j',
    (raw) => {
      expect(caseFile(ROOT, raw)).toBeNull();
    },
  );
});

describe('acceptanceCases', () => {
  it('keeps only cases whose file is inside the acceptance folder', () => {
    const inside = tc('tests/acceptance/a.test.ts');
    const r = acceptanceCases(ROOT, 'tests/acceptance', [inside, tc('src/decoy.test.ts'), tc('tests/acceptance-evil/x.test.ts')]);
    expect(r.cases).toEqual([inside]);
    expect(r.problems).toEqual([]);
  });
  it('reports a row-tagged case with no usable file; untagged ones are ignored (Review Focus 5)', () => {
    const r = acceptanceCases(ROOT, 'tests/acceptance', [tc(''), tc('', [])]);
    expect(r.cases).toEqual([]);
    expect(r.problems).toEqual([
      'Test "[LST-001] t" has no usable file path in the JUnit report (file=""); configure the reporter to record each test\'s file',
    ]);
  });
});
