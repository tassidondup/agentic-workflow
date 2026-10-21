import { describe, expect, it } from 'vitest';
import { hiddenFailures, parseJUnit } from '../src/junit.js';

describe('parseJUnit (Review Focus 4)', () => {
  it('parses nested suites with passed, failed, errored and skipped cases', () => {
    const xml = `<?xml version="1.0"?>
<testsuites>
  <testsuite name="outer">
    <testsuite name="inner">
      <testcase classname="price" name="[LST-001] rejects price 0"/>
      <testcase classname="price" name="[LST-002] rejects over limit"><failure message="x"/></testcase>
    </testsuite>
    <testcase classname="dup" name="[LST-003] duplicate submit"><error message="boom"/></testcase>
    <testcase classname="dup" name="[LST-004] skipped one"><skipped/></testcase>
  </testsuite>
</testsuites>`;
    expect(parseJUnit(xml).map((c) => `${c.rowIds.join('+')}:${c.status}`)).toEqual([
      'LST-001:passed', 'LST-002:failed', 'LST-003:failed', 'LST-004:skipped',
    ]);
  });

  it('accepts a single <testsuite> root and multiple row tags on one test', () => {
    const xml = '<testsuite name="s"><testcase classname="c" name="[LST-001][LST-002] shared setup"></testcase></testsuite>';
    expect(parseJUnit(xml)).toEqual([{ name: '[LST-001][LST-002] shared setup', classname: 'c', file: 'c', status: 'passed', rowIds: ['LST-001', 'LST-002'] }]);
  });

  it('takes each case file from its file attribute, else its classname (ADR 0001)', () => {
    const xml = '<testsuite name="s"><testcase classname="tests/a.test.ts" name="[LST-001] x"/><testcase classname="Suite" file="./tests/b.test.ts" name="[LST-002] y"/></testsuite>';
    expect(parseJUnit(xml).map((c) => c.file)).toEqual(['tests/a.test.ts', './tests/b.test.ts']);
  });

  it('picks up a row tag that appears only in the classname', () => {
    const xml = '<testsuite name="s"><testcase classname="[LST-007] price limits" name="rejects 0"/></testsuite>';
    expect(parseJUnit(xml)[0]?.rowIds).toEqual(['LST-007']);
  });

  it('returns an empty list for a suite with no tests', () => {
    expect(parseJUnit('<testsuites><testsuite name="empty" tests="0"></testsuite></testsuites>')).toEqual([]);
  });

  it('rejects invalid XML and documents without suites', () => {
    expect(() => parseJUnit('<testsuite><testcase>')).toThrow(/Invalid JUnit XML/);
    expect(() => parseJUnit('<report/>')).toThrow(/no <testsuite> elements/);
  });

  it('does not expand DOCTYPE entities (R11: processEntities disabled)', () => {
    const xml = '<!DOCTYPE x [<!ENTITY a "aaaa">]><testsuite name="s"><testcase classname="c" name="[LST-001] &a; case"/></testsuite>';
    const [only] = parseJUnit(xml);
    expect(only?.name).toBe('[LST-001] &a; case');
    expect(only?.rowIds).toEqual(['LST-001']);
  });
});

describe('hiddenFailures', () => {
  const ok = '<testcase classname="c" name="a"/>';
  const bad = '<testcase classname="c" name="b"><failure message="x"/></testcase>';

  it('finds nothing in a consistent report', () => {
    expect(hiddenFailures(`<testsuites tests="2" failures="1" errors="0"><testsuite name="s" tests="2" failures="1" errors="0">${ok}${bad}</testsuite></testsuites>`)).toEqual([]);
  });

  it('finds nothing when counts are absent or the parent aggregates its children', () => {
    expect(hiddenFailures(`<testsuite name="s">${ok}${bad}</testsuite>`)).toEqual([]);
    expect(hiddenFailures(`<testsuites failures="1"><testsuite name="outer" failures="1"><testsuite name="inner" failures="1">${bad}</testsuite></testsuite></testsuites>`)).toEqual([]);
  });

  it('flags a suite that declares more errors than its listed failed tests', () => {
    const problems = hiddenFailures(`<testsuite name="broken.test.ts" tests="1" failures="0" errors="1">${ok}</testsuite>`);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/broken\.test\.ts.*1 failure or error.*0 failed tests/);
  });

  it('flags an error element outside any test case', () => {
    const problems = hiddenFailures(`<testsuite name="load.test.ts">${ok}<error message="Cannot find module"/></testsuite>`);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/load\.test\.ts.*outside any test/);
  });

  it('flags a root that declares failures no test lists', () => {
    expect(hiddenFailures(`<testsuites failures="2"><testsuite name="s">${ok}${bad}</testsuite></testsuites>`)).toHaveLength(1);
  });
});
