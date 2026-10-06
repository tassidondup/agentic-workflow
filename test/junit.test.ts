import { describe, expect, it } from 'vitest';
import { parseJUnit } from '../src/junit.js';

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
    expect(parseJUnit(xml)).toEqual([{ name: '[LST-001][LST-002] shared setup', classname: 'c', status: 'passed', rowIds: ['LST-001', 'LST-002'] }]);
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
