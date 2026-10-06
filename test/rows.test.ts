import { describe, expect, it } from 'vitest';
import { parseRows } from '../src/rows.js';

const md = [
  '# Listing price',
  '',
  '| ID | Price | Expected |',
  '|----|------:|----------|',
  '| LST-001 | 0 | 422 |',
  '| LST-002 | 999999 | 201 |',
  '',
  '```md',
  '| ID | ignored | Expected |',
  '|---|---|---|',
  '| LST-999 | x | y |',
  '```',
  '',
  '| Name | Value |',
  '|---|---|',
  '| a | b |',
].join('\n');

describe('parseRows', () => {
  it('parses ID tables with cells keyed by header and 1-based line numbers', () => {
    const rows = parseRows(md, 'docs/specs/listing/spec.md');
    expect(rows.map((r) => r.id)).toEqual(['LST-001', 'LST-002']);
    expect(rows[0]).toEqual({
      id: 'LST-001',
      cells: { ID: 'LST-001', Price: '0', Expected: '422' },
      file: 'docs/specs/listing/spec.md',
      line: 5,
    });
  });
  it('handles CRLF line endings', () => {
    expect(parseRows(md.replaceAll('\n', '\r\n'), 'f.md').map((r) => r.id)).toEqual(['LST-001', 'LST-002']);
  });
  it('ignores a header without a separator row', () => {
    expect(parseRows('| ID | Expected |\n| LST-001 | x |', 'f.md')).toEqual([]);
  });
  it('ignores tables inside tilde fences and treats ``` inside ~~ as non-closing', () => {
    const md = [
      '| ID | Expected |',
      '|---|---|',
      '| LST-001 | a |',
      '',
      '~~~',
      '| ID | Other |',
      '|---|---|',
      '| LST-002 | b |',
      '```',
      '| ID | Still in tilde |',
      '|---|---|',
      '| LST-003 | c |',
      '~~~',
      '',
      '| ID | Expected |',
      '|---|---|',
      '| LST-004 | d |',
    ].join('\n');
    const rows = parseRows(md, 'f.md');
    expect(rows.map((r) => r.id)).toEqual(['LST-001', 'LST-004']);
  });
  it('accepts separators with 1-2 dashes', () => {
    expect(parseRows('| ID | Expected |\n|-|-|\n| LST-001 | x |', 'f.md').map((r) => r.id)).toEqual(['LST-001']);
    expect(parseRows('| ID | Expected |\n|:-|--:|\n| LST-002 | y |', 'f.md').map((r) => r.id)).toEqual(['LST-002']);
  });
});
